"use node"

/**
 * Retriever creation (config hash), start indexing, standalone retrieve entry point.
 *
 * Actions live here ("use node") because they orchestrate pipeline_actions.ts
 * and indexing_actions.ts, which require Node.js built-ins (openai, cohere).
 */
import {
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  type PipelineConfig
} from "@tars-inc/eval-lib"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { tenantAction } from "../lib/auth/tenant"
import {
  buildStatelessRetriever,
  scoredToChunkResults
} from "./retrieval_runtime"
import {
  assertEmbeddingBackendCompatible,
  qdrantCollectionName,
  resolveVectorBackend
} from "./vector_backend"

// ─── Create Retriever ───

/**
 * Create a retriever for a KB with a given pipeline config.
 * This is an action (not mutation) because it needs Node.js crypto for hash computation.
 * Does NOT trigger indexing — use startIndexing separately.
 * Dedup: returns existing retriever if (kbId, retrieverConfigHash) already exists.
 */
export const create = tenantAction({
  args: {
    kbId: v.id("knowledgeBases"),
    retrieverConfig: v.any()
  },
  handler: async (
    ctx,
    args
  ): Promise<{ retrieverId: Id<"retrievers">; existing: boolean }> => {
    const { orgId, userId } = ctx

    const config = args.retrieverConfig as PipelineConfig & { k?: number }
    const k = config.k ?? 5

    // Compute both hashes (requires Node crypto)
    const indexConfigHash = computeIndexConfigHash(config)
    const retrieverConfigHash = computeRetrieverConfigHash(config, k)

    // Dedup: check if retriever with same (kbId, retrieverConfigHash) exists
    const existing = await ctx.runQuery(
      internal.kb.retrievers.findByConfigHash,
      { kbId: args.kbId, retrieverConfigHash }
    )

    if (existing) {
      return { retrieverId: existing._id, existing: true }
    }

    const name = config.name ?? `retriever-${retrieverConfigHash.slice(0, 8)}`

    // Stamp the vector backend and (for qdrant) the collection name at
    // creation time so retrieval never has to recompute it.
    const indexSettings = (config.index ?? {}) as Record<string, unknown>
    const vectorBackend = resolveVectorBackend(indexSettings.vectorBackend)
    // Reject native + non-OpenAI up front rather than at index time.
    assertEmbeddingBackendCompatible(
      vectorBackend,
      indexSettings.embeddingProvider
    )
    const qdrantCollection =
      vectorBackend === "qdrant"
        ? qdrantCollectionName(String(args.kbId), indexConfigHash)
        : undefined

    const retrieverId = await ctx.runMutation(
      internal.kb.retrievers.insertRetriever,
      {
        orgId,
        kbId: args.kbId,
        name,
        retrieverConfig: args.retrieverConfig,
        indexConfigHash,
        retrieverConfigHash,
        defaultK: k,
        vectorBackend,
        qdrantCollection,
        status: "configuring",
        createdBy: userId
      }
    )

    return { retrieverId, existing: false }
  }
})

// ─── Start Indexing ───

/**
 * Start indexing for a retriever. Triggers the indexing pipeline and updates
 * the retriever status to "indexing" (or "ready" if already indexed).
 */
export const startIndexing = tenantAction({
  args: {
    retrieverId: v.id("retrievers")
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const { orgId, userId } = ctx

    const retriever = await ctx.runQuery(internal.kb.retrievers.getInternal, {
      id: args.retrieverId
    })

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "configuring" && retriever.status !== "error") {
      throw new Error(`Cannot start indexing: retriever is ${retriever.status}`)
    }

    const config = retriever.retrieverConfig as PipelineConfig & { k?: number }

    // Resolve index config for the indexing service
    const indexSettings = (config.index ?? {}) as Record<string, unknown>
    const strategy = (indexSettings.strategy as string) ?? "plain"
    const embeddingModel =
      (indexSettings.embeddingModel as string) ?? "text-embedding-3-small"

    const indexConfig =
      strategy === "parent-child"
        ? {
            strategy: "parent-child" as const,
            childChunkSize: (indexSettings.childChunkSize as number) ?? 200,
            parentChunkSize: (indexSettings.parentChunkSize as number) ?? 1000,
            childOverlap: (indexSettings.childOverlap as number) ?? 0,
            parentOverlap: (indexSettings.parentOverlap as number) ?? 100,
            embeddingModel,
            vectorBackend: indexSettings.vectorBackend as string | undefined,
            embeddingProvider: indexSettings.embeddingProvider as
              | string
              | undefined
          }
        : {
            strategy: "plain" as const,
            chunkSize: (indexSettings.chunkSize as number) ?? 1000,
            chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
            separators: indexSettings.separators as string[] | undefined,
            embeddingModel,
            vectorBackend: indexSettings.vectorBackend as string | undefined,
            embeddingProvider: indexSettings.embeddingProvider as
              | string
              | undefined
          }

    // Trigger indexing
    const indexResult = await ctx.runMutation(
      internal.kb.indexing.startIndexing,
      {
        orgId,
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        indexConfig,
        createdBy: userId
      }
    )

    // Determine status
    let status: "configuring" | "indexing" | "ready" | "error"
    let chunkCount: number | undefined

    if (indexResult.alreadyCompleted) {
      const job = await ctx.runQuery(internal.kb.indexing.getJobInternal, {
        jobId: indexResult.jobId
      })
      chunkCount = job?.totalChunks
      status = "ready"
    } else {
      status = "indexing"
    }

    await ctx.runMutation(internal.kb.retrievers.updateIndexingStatus, {
      retrieverId: args.retrieverId,
      indexingJobId: indexResult.jobId,
      status,
      chunkCount
    })

    return { status }
  }
})

// ─── Retrieve ───

/**
 * Standalone retrieval: given a retriever ID and query, return ranked chunks.
 * Used by the playground and future production consumers.
 */
export const retrieve = tenantAction({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
    k: v.optional(v.number())
  },
  handler: async (
    ctx,
    args
  ): Promise<
    {
      chunkId: string
      content: string
      docId: string
      start: number
      end: number
      score: number
      metadata: Record<string, unknown>
    }[]
  > => {
    const { orgId } = ctx

    // Load retriever
    const retriever = await ctx.runQuery(internal.kb.retrievers.getInternal, {
      id: args.retrieverId
    })

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
      )
    }

    const config = retriever.retrieverConfig as PipelineConfig & {
      k?: number
    }
    const topK = args.k ?? retriever.defaultK

    const unified = await buildStatelessRetriever(ctx, {
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      retrieverConfig: config as unknown as Record<string, unknown>,
      qdrantCollection: retriever.qdrantCollection
    })
    try {
      const scored = await unified.retrieveScored(args.query, topK)
      return scoredToChunkResults(scored)
    } finally {
      unified.cleanup()
    }
  }
})
