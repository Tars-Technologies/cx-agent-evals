/**
 * Indexing job orchestration: WorkPool callbacks, status transitions, cancel.
 *
 * Owns the indexing WorkPool; mutations here drive job lifecycle but delegate
 * chunk-embedding work to indexing_actions.ts.
 */
import {
  type RunResult,
  vOnCompleteArgs,
  type WorkId,
  Workpool
} from "@convex-dev/workpool"
import type { JobStatus } from "@tars-inc/eval-lib/shared"
import type { PaginationResult } from "convex/server"
import { v } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"
import { qdrantCollectionName, resolveVectorBackend } from "./vector_backend"

// ─── WorkPool Instance ───

const pool = new Workpool(components.indexingPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2
  }
})

// ─── Tier-based Parallelism ───

const TIER_PARALLELISM: Record<string, number> = {
  free: 3,
  pro: 10,
  enterprise: 20
}

// ─── Document Page Query ───

export const getDocumentPage = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    cursor: v.union(v.string(), v.null())
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .paginate({ numItems: 100, cursor: args.cursor })
  }
})

// ─── Start Indexing ───

/**
 * Kick off indexing for all documents in a knowledge base.
 * Creates an indexingJob record and fans out one WorkPool action per document.
 *
 * Callers must pre-compute `indexConfigHash` (requires Node crypto).
 */
export const startIndexing = internalMutation({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    indexConfig: v.any(),
    createdBy: v.string(),
    tier: v.optional(v.string()),
    force: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    // Dedup: reject if a running/pending job already exists for this config
    const existingJob = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "running")
        )
      )
      .first()

    if (existingJob) {
      return { jobId: existingJob._id, alreadyRunning: true }
    }

    // Check if already fully indexed
    const completedJob = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "completed"),
          q.eq(q.field("status"), "completed_with_errors")
        )
      )
      .first()

    if (completedJob && !args.force) {
      return { jobId: completedJob._id, alreadyCompleted: true }
    }

    // Force re-index: delete the old completed job record
    if (completedJob && args.force) {
      await ctx.db.delete(completedJob._id)
    }

    // Use denormalized count for totalDocs and emptiness check.
    const kb = await ctx.db.get(args.kbId)
    if (!kb) throw new Error("Knowledge base not found")
    const totalDocs = kb.documentCount ?? 0
    if (totalDocs === 0) {
      throw new Error("No documents in knowledge base to index")
    }

    // Set tier-based parallelism
    const tier = args.tier ?? "free"
    const parallelism = TIER_PARALLELISM[tier] ?? TIER_PARALLELISM.free
    await ctx.runMutation(components.indexingPool.config.update, {
      maxParallelism: parallelism
    })

    // Extract chunking/embedding config
    const indexConfig = args.indexConfig as Record<string, any>

    // Resolve the vector backend; the qdrant collection name is computed
    // once here and stamped on the job (and retriever) at creation time.
    const vectorBackend = resolveVectorBackend(indexConfig.vectorBackend)
    const qdrantCollection =
      vectorBackend === "qdrant"
        ? qdrantCollectionName(String(args.kbId), args.indexConfigHash)
        : undefined

    // Create job record
    const jobId = await ctx.db.insert("indexingJobs", {
      orgId: args.orgId,
      kbId: args.kbId,
      indexConfigHash: args.indexConfigHash,
      indexConfig: args.indexConfig,
      vectorBackend,
      qdrantCollection,
      status: "running",
      totalDocs,
      processedDocs: 0,
      failedDocs: 0,
      skippedDocs: 0,
      totalChunks: 0,
      createdBy: args.createdBy,
      createdAt: Date.now()
    })

    // Enqueue one action per document. Use ctx.runQuery per page so each
    // paginate() call is its own function invocation (Convex allows only one
    // paginated query per invocation).
    const workIds: WorkId[] = []
    let cursor: string | null = null
    while (true) {
      const page: PaginationResult<Doc<"documents">> = await ctx.runQuery(
        internal.kb.indexing.getDocumentPage,
        { kbId: args.kbId, cursor }
      )
      for (const doc of page.page) {
        const wId = await pool.enqueueAction(
          ctx,
          internal.kb.indexing_actions.indexDocument,
          {
            documentId: doc._id,
            kbId: args.kbId,
            indexConfigHash: args.indexConfigHash,
            // Pass all strategy-specific fields
            strategy: indexConfig.strategy,
            chunkSize: indexConfig.chunkSize,
            chunkOverlap: indexConfig.chunkOverlap,
            embeddingModel: indexConfig.embeddingModel,
            embeddingProvider: indexConfig.embeddingProvider,
            childChunkSize: indexConfig.childChunkSize,
            parentChunkSize: indexConfig.parentChunkSize,
            childOverlap: indexConfig.childOverlap,
            parentOverlap: indexConfig.parentOverlap,
            vectorBackend,
            qdrantCollection
          },
          {
            context: { jobId, documentId: doc._id },
            onComplete: internal.kb.indexing.onDocumentIndexed
          }
        )
        workIds.push(wId)
      }
      if (page.isDone) break
      cursor = page.continueCursor
    }

    // Store workIds on the job for selective cancellation
    await ctx.db.patch(jobId, { workIds: workIds as string[] })

    return { jobId, alreadyRunning: false, totalDocs }
  }
})

// ─── WorkPool onComplete Callback ───

/**
 * Called by WorkPool after each document action completes (success, failure, or cancel).
 * Updates the indexingJob's progress counters and detects job completion.
 *
 * Uses internalMutation + vOnCompleteArgs (not pool.defineOnComplete) so that
 * ctx.db has full DataModel type information for typed field access.
 */
export const onDocumentIndexed = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("indexingJobs"),
      documentId: v.id("documents")
    })
  ),
  handler: async (
    ctx,
    {
      context,
      result
    }: {
      workId: string
      context: { jobId: Id<"indexingJobs">; documentId: Id<"documents"> }
      result: RunResult
    }
  ) => {
    const job = await ctx.db.get(context.jobId)
    if (!job) return

    // Already fully canceled — nothing to update
    if (job.status === "canceled") {
      return
    }

    let processedDocs = job.processedDocs
    let failedDocs = job.failedDocs
    let skippedDocs = job.skippedDocs
    let totalChunks = job.totalChunks
    const failedDocDetails: Array<{
      documentId: Id<"documents">
      error: string
    }> = [...(job.failedDocDetails ?? [])]

    if (result.kind === "success") {
      const returnValue = result.returnValue as {
        skipped: boolean
        chunksInserted: number
        chunksEmbedded: number
      }
      if (returnValue.skipped) {
        skippedDocs++
      } else {
        processedDocs++
      }
      totalChunks += returnValue.chunksInserted
    } else if (result.kind === "failed") {
      failedDocs++
      failedDocDetails.push({
        documentId: context.documentId,
        error: result.error
      })
    } else if (result.kind === "canceled") {
      skippedDocs++
    }

    // Check if all documents have been handled
    const totalHandled = processedDocs + failedDocs + skippedDocs
    const isComplete = totalHandled >= job.totalDocs

    let status: JobStatus = job.status
    let completedAt: number | undefined

    if (job.status === "canceling" && isComplete) {
      // All in-progress docs finished — finalize cancellation
      status = "canceled"
      completedAt = Date.now()
    } else if (isComplete && job.status === "running") {
      if (failedDocs === 0) {
        status = "completed"
      } else if (failedDocs === job.totalDocs) {
        status = "failed"
      } else {
        status = "completed_with_errors"
      }
      completedAt = Date.now()
    }

    await ctx.db.patch(context.jobId, {
      processedDocs,
      failedDocs,
      skippedDocs,
      totalChunks,
      failedDocDetails:
        failedDocDetails.length > 0 ? failedDocDetails : undefined,
      status,
      ...(completedAt !== undefined ? { completedAt } : {})
    })

    // If job just completed, sync any retrievers that reference this indexing job
    if (isComplete) {
      const retrievers = await ctx.db
        .query("retrievers")
        .withIndex("by_kb", (q) => q.eq("kbId", job.kbId))
        .collect()

      for (const retriever of retrievers) {
        if (
          retriever.indexingJobId === context.jobId &&
          retriever.status === "indexing"
        ) {
          await ctx.runMutation(
            internal.kb.retrievers.syncStatusFromIndexingJob,
            { retrieverId: retriever._id }
          )
        }
      }
    }
  }
})

// ─── Queries ───

/**
 * Get an indexing job with computed pendingDocs count.
 */
export const getJob = tenantQuery({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.orgId !== ctx.orgId) return null

    const pendingDocs =
      job.totalDocs - job.processedDocs - job.failedDocs - job.skippedDocs
    return { ...job, pendingDocs }
  }
})

/**
 * Check if a (kbId, indexConfigHash) has a completed indexing job.
 */
export const isIndexed = tenantQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string()
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "completed"),
          q.eq(q.field("status"), "completed_with_errors")
        )
      )
      .first()
    return job !== null
  }
})

/**
 * List all indexing jobs for the current org, newest first.
 */
export const listJobs = tenantQuery({
  args: {
    kbId: v.optional(v.id("knowledgeBases"))
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("indexingJobs")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .order("desc")
      .collect()
    if (args.kbId) {
      return jobs.filter((j) => j.kbId === args.kbId)
    }
    return jobs
  }
})

// ─── Mutations ───

/**
 * Cancel a running indexing job. Sets status to "canceling" and cancels
 * only this job's pending WorkPool items. Already-running actions will
 * finish normally. The job transitions to "canceled" once all in-progress
 * documents complete.
 */
export const cancelIndexing = tenantMutation({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.orgId !== ctx.orgId) {
      throw new Error("Indexing job not found")
    }
    if (job.status !== "running" && job.status !== "pending") {
      throw new Error(`Cannot cancel job in status: ${job.status}`)
    }

    // Set status to "canceling" first so in-flight callbacks see the updated state
    await ctx.db.patch(args.jobId, { status: "canceling" })

    // Cancel only this job's work items, not the entire pool
    for (const wId of job.workIds ?? []) {
      await pool.cancel(ctx, wId as WorkId)
    }
  }
})

/**
 * Schedule cleanup of all chunks for a (kbId, indexConfigHash).
 * Delegates to the cleanupAction for paginated deletion.
 */
export const cleanupIndex = tenantMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    deleteDocuments: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== ctx.orgId) {
      throw new Error("Knowledge base not found")
    }

    // Find associated indexing job (if any)
    const job = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash)
      )
      .first()

    await ctx.scheduler.runAfter(
      0,
      internal.kb.indexing_actions.cleanupAction,
      {
        kbId: args.kbId,
        indexConfigHash: args.indexConfigHash,
        jobId: job?._id,
        deleteDocuments: args.deleteDocuments,
        vectorBackend: job?.vectorBackend,
        qdrantCollection: job?.qdrantCollection
      }
    )

    return { scheduled: true }
  }
})

// ─── Internal Helpers ───

/**
 * Get indexing job status without auth (for internal actions like experiment runner).
 */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId)
  }
})

/**
 * Delete an indexing job record. Used by cleanupAction after
 * all chunks have been deleted.
 */
export const deleteJob = internalMutation({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.jobId)
  }
})
