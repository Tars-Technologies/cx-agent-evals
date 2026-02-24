import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import { Workpool, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "./lib/auth";
import { Id } from "./_generated/dataModel";

// ─── WorkPool Instance ───

const pool = new Workpool(components.indexingPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// ─── Tier-based Parallelism ───

const TIER_PARALLELISM: Record<string, number> = {
  free: 3,
  pro: 10,
  enterprise: 20,
};

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
    createdBy: v.id("users"),
    tier: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Dedup: reject if a running/pending job already exists for this config
    const existingJob = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "running"),
        ),
      )
      .first();

    if (existingJob) {
      return { jobId: existingJob._id, alreadyRunning: true };
    }

    // Check if already fully indexed
    const completedJob = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "completed"),
          q.eq(q.field("status"), "completed_with_errors"),
        ),
      )
      .first();

    if (completedJob && !args.force) {
      return { jobId: completedJob._id, alreadyCompleted: true };
    }

    // Force re-index: delete the old completed job record
    if (completedJob && args.force) {
      await ctx.db.delete(completedJob._id);
    }

    // Get all documents for this KB
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect();

    if (docs.length === 0) {
      throw new Error("No documents in knowledge base to index");
    }

    // Set tier-based parallelism
    const tier = args.tier ?? "free";
    const parallelism = TIER_PARALLELISM[tier] ?? TIER_PARALLELISM.free;
    await ctx.runMutation(components.indexingPool.config.update, {
      maxParallelism: parallelism,
    });

    // Create job record
    const jobId = await ctx.db.insert("indexingJobs", {
      orgId: args.orgId,
      kbId: args.kbId,
      indexConfigHash: args.indexConfigHash,
      indexConfig: args.indexConfig,
      status: "running",
      totalDocs: docs.length,
      processedDocs: 0,
      failedDocs: 0,
      skippedDocs: 0,
      totalChunks: 0,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });

    // Extract chunking/embedding config
    const indexConfig = args.indexConfig as Record<string, any>;

    // Enqueue one action per document with per-document context
    for (const doc of docs) {
      await pool.enqueueAction(
        ctx,
        internal.indexingActions.indexDocument,
        {
          documentId: doc._id,
          kbId: args.kbId,
          indexConfigHash: args.indexConfigHash,
          chunkSize: indexConfig.chunkSize,
          chunkOverlap: indexConfig.chunkOverlap,
          embeddingModel: indexConfig.embeddingModel,
        },
        {
          context: { jobId, documentId: doc._id },
          onComplete: internal.indexing.onDocumentIndexed,
        },
      );
    }

    return { jobId, alreadyRunning: false, totalDocs: docs.length };
  },
});

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
      documentId: v.id("documents"),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"indexingJobs">; documentId: Id<"documents"> };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;

    // Already fully canceled — nothing to update
    if (job.status === "canceled") {
      return;
    }

    let processedDocs = job.processedDocs;
    let failedDocs = job.failedDocs;
    let skippedDocs = job.skippedDocs;
    let totalChunks = job.totalChunks;
    let failedDocDetails: Array<{ documentId: Id<"documents">; error: string }> =
      [...(job.failedDocDetails ?? [])];

    if (result.kind === "success") {
      const returnValue = result.returnValue as {
        skipped: boolean;
        chunksInserted: number;
        chunksEmbedded: number;
      };
      if (returnValue.skipped) {
        skippedDocs++;
      } else {
        processedDocs++;
      }
      totalChunks += returnValue.chunksInserted;
    } else if (result.kind === "failed") {
      failedDocs++;
      failedDocDetails.push({
        documentId: context.documentId,
        error: result.error,
      });
    } else if (result.kind === "canceled") {
      skippedDocs++;
    }

    // Check if all documents have been handled
    const totalHandled = processedDocs + failedDocs + skippedDocs;
    const isComplete = totalHandled >= job.totalDocs;

    type JobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "canceling" | "canceled";
    let status: JobStatus = job.status;
    let completedAt: number | undefined;

    if (job.status === "canceling" && isComplete) {
      // All in-progress docs finished — finalize cancellation
      status = "canceled";
      completedAt = Date.now();
    } else if (isComplete && job.status === "running") {
      if (failedDocs === 0) {
        status = "completed";
      } else if (failedDocs === job.totalDocs) {
        status = "failed";
      } else {
        status = "completed_with_errors";
      }
      completedAt = Date.now();
    }

    await ctx.db.patch(context.jobId, {
      processedDocs,
      failedDocs,
      skippedDocs,
      totalChunks,
      failedDocDetails:
        failedDocDetails.length > 0 ? failedDocDetails : undefined,
      status,
      ...(completedAt !== undefined ? { completedAt } : {}),
    });
  },
});

// ─── Queries ───

/**
 * Get an indexing job with computed pendingDocs count.
 */
export const getJob = query({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) return null;

    const pendingDocs = job.totalDocs - job.processedDocs - job.failedDocs - job.skippedDocs;
    return { ...job, pendingDocs };
  },
});

/**
 * Check if a (kbId, indexConfigHash) has a completed indexing job.
 */
export const isIndexed = query({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "completed"),
          q.eq(q.field("status"), "completed_with_errors"),
        ),
      )
      .first();
    return job !== null;
  },
});

/**
 * List all indexing jobs for the current org, newest first.
 */
export const listJobs = query({
  args: {
    kbId: v.optional(v.id("knowledgeBases")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const jobs = await ctx.db
      .query("indexingJobs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    if (args.kbId) {
      return jobs.filter((j) => j.kbId === args.kbId);
    }
    return jobs;
  },
});

// ─── Mutations ───

/**
 * Cancel a running indexing job. Sets status to "canceling" and cancels
 * all pending WorkPool items. Already-running actions will finish normally.
 * The job transitions to "canceled" once all in-progress documents complete.
 */
export const cancelIndexing = mutation({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) {
      throw new Error("Indexing job not found");
    }
    if (job.status !== "running" && job.status !== "pending") {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }

    await pool.cancelAll(ctx);
    await ctx.db.patch(args.jobId, {
      status: "canceling",
    });
  },
});

/**
 * Schedule cleanup of all chunks for a (kbId, indexConfigHash).
 * Delegates to the cleanupAction for paginated deletion.
 */
export const cleanupIndex = mutation({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    deleteDocuments: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    // Find associated indexing job (if any)
    const job = await ctx.db
      .query("indexingJobs")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .first();

    await ctx.scheduler.runAfter(0, internal.indexingActions.cleanupAction, {
      kbId: args.kbId,
      indexConfigHash: args.indexConfigHash,
      jobId: job?._id,
      deleteDocuments: args.deleteDocuments,
    });

    return { scheduled: true };
  },
});

// ─── Internal Helpers ───

/**
 * Get indexing job status without auth (for internal actions like experiment runner).
 */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/**
 * Delete an indexing job record. Used by cleanupAction after
 * all chunks have been deleted.
 */
export const deleteJob = internalMutation({
  args: { jobId: v.id("indexingJobs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.jobId);
  },
});
