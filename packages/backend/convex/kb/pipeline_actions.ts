"use node"

/**
 * Retrieval pipeline stage actions: query rewrite, search, refinement, and the
 * full traced retrieve. All four collapse onto the eval-lib
 * StatelessQueryRetriever (composed in retrieval_runtime.ts); this file only
 * loads/validates the retriever, drives the retriever's stage methods, and maps
 * the trace back to the frozen public response shapes the playground tabs read.
 */
import type {
  PipelineConfig,
  RefinementStepConfig,
  SearchConfig
} from "@tars-inc/eval-lib"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import { tenantAction } from "../lib/auth/tenant"
import {
  buildStatelessRetriever,
  type ChunkResultShape,
  chunkResultsToScored,
  rerankerAvailable,
  scoredToChunkResults
} from "./retrieval_runtime"

// ---------------------------------------------------------------------------
// Response shapes (frozen: the playground tabs consume these as-is). The
// explicit aliases double as the action handlers' return-type annotations,
// which Convex codegen needs to break circular type inference. They are type
// aliases (not interfaces) so the frontend can still cast results to its own
// Record-based view types via implicit index signatures.
// ---------------------------------------------------------------------------

type SearchConfigMeta = {
  strategy: string
  denseWeight?: number
  sparseWeight?: number
  fusionMethod?: string
  candidateMultiplier?: number
  k: number
}

type RewriteResponse = {
  strategy: string
  original: string
  rewrittenQueries: string[]
  hypotheticalAnswer?: string
  latencyMs: number
}

type SearchResponse = {
  searchConfig: SearchConfigMeta
  perQueryResults: Array<{ query: string; chunks: ChunkResultShape[] }>
  fusedResults: ChunkResultShape[]
  latencyMs: number
}

type RefinementStageResult = {
  name: string
  config: Record<string, unknown>
  inputCount: number
  outputCount: number
  outputChunks: ChunkResultShape[]
  latencyMs: number
}

type RefineResponse = {
  stages: RefinementStageResult[]
  finalChunks: ChunkResultShape[]
}

type RetrieveWithTraceResponse = {
  rewriting: RewriteResponse
  search: SearchResponse
  refinement: RefineResponse & { latencyMs: number }
  finalChunks: ChunkResultShape[]
  totalLatencyMs: number
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Display metadata echoed back with search responses (shape frozen). */
function buildSearchConfigMeta(
  searchConfig: SearchConfig,
  k: number
): SearchConfigMeta {
  const meta: SearchConfigMeta = { strategy: searchConfig.strategy, k }
  if (searchConfig.strategy === "hybrid") {
    meta.denseWeight = searchConfig.denseWeight ?? 0.7
    meta.sparseWeight = searchConfig.sparseWeight ?? 0.3
    meta.fusionMethod = searchConfig.fusionMethod ?? "rrf"
    meta.candidateMultiplier = searchConfig.candidateMultiplier ?? 3
  }
  return meta
}

/** Loud failure preserved from the old runRefinementStage rerank branch. */
function rerankUnavailableError(
  refinementSteps: readonly RefinementStepConfig[]
): Error {
  const step = refinementSteps.find((s) => s.type === "rerank") as
    | { provider?: string }
    | undefined
  return new Error(
    `Rerank step has no usable reranker for provider ` +
      `"${step?.provider ?? "cohere"}": check the provider name and that ` +
      `its API key is set (COHERE_API_KEY / JINA_API_KEY / VOYAGE_API_KEY).`
  )
}

// ===========================================================================
// Rewrite Query (Stage 1)
// ===========================================================================

/**
 * Rewrite a query according to a retriever's query strategy configuration.
 * Returns the strategy name, original query, rewritten queries, and latency.
 */
export const rewriteQuery = tenantAction({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string()
  },
  handler: async (ctx, args): Promise<RewriteResponse> => {
    const retriever: Doc<"retrievers"> = await ctx.runQuery(
      internal.kb.retrievers.getInternal,
      { id: args.retrieverId }
    )

    if (retriever.orgId !== ctx.orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
      )
    }

    const unified = await buildStatelessRetriever(ctx, {
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      retrieverConfig: retriever.retrieverConfig as Record<string, unknown>,
      qdrantCollection: retriever.qdrantCollection
    })
    try {
      const trace = await unified.expandQuery(args.query)
      return {
        strategy: trace.strategy,
        original: trace.original,
        rewrittenQueries: [...trace.queries],
        hypotheticalAnswer: trace.hypotheticalAnswer,
        latencyMs: trace.latencyMs
      }
    } finally {
      unified.cleanup()
    }
  }
})

// ===========================================================================
// Search With Queries (Stage 2)
// ===========================================================================

export const searchWithQueries = tenantAction({
  args: {
    retrieverId: v.id("retrievers"),
    queries: v.array(v.string()),
    k: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    const retriever: Doc<"retrievers"> = await ctx.runQuery(
      internal.kb.retrievers.getInternal,
      { id: args.retrieverId }
    )

    if (retriever.orgId !== ctx.orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
      )
    }

    if (args.queries.length === 0) {
      throw new Error("At least one query is required")
    }

    const config = retriever.retrieverConfig as PipelineConfig
    const searchConfig: SearchConfig = (config.search as
      | SearchConfig
      | undefined) ?? {
      strategy: "dense"
    }
    const topK = args.k ?? retriever.defaultK

    const unified = await buildStatelessRetriever(ctx, {
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      retrieverConfig: config as unknown as Record<string, unknown>,
      qdrantCollection: retriever.qdrantCollection
    })
    try {
      const trace = await unified.searchQueries(args.queries, topK)
      return {
        searchConfig: buildSearchConfigMeta(searchConfig, topK),
        perQueryResults: trace.perQueryResults.map((r) => ({
          query: r.query,
          chunks: scoredToChunkResults(r.chunks)
        })),
        fusedResults: scoredToChunkResults(trace.fusedResults.slice(0, topK)),
        latencyMs: trace.latencyMs
      }
    } finally {
      unified.cleanup()
    }
  }
})

// ===========================================================================
// Refine (Stage 3, post-retrieval refinement)
// ===========================================================================

export const refine = tenantAction({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
    chunks: v.array(
      v.object({
        chunkId: v.string(),
        content: v.string(),
        docId: v.string(),
        start: v.number(),
        end: v.number(),
        score: v.number(),
        metadata: v.any()
      })
    ),
    k: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<RefineResponse> => {
    const retriever: Doc<"retrievers"> = await ctx.runQuery(
      internal.kb.retrievers.getInternal,
      { id: args.retrieverId }
    )

    if (retriever.orgId !== ctx.orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
      )
    }

    const config = retriever.retrieverConfig as PipelineConfig
    const refinementSteps =
      (config.refinement as RefinementStepConfig[] | undefined) ?? []
    const k = args.k ?? retriever.defaultK
    const needsReranker = refinementSteps.some((s) => s.type === "rerank")

    const unified = await buildStatelessRetriever(ctx, {
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      retrieverConfig: config as unknown as Record<string, unknown>,
      qdrantCollection: retriever.qdrantCollection
    })
    try {
      if (
        needsReranker &&
        !(await rerankerAvailable(
          refinementSteps as unknown as Array<Record<string, unknown>>
        ))
      ) {
        throw rerankUnavailableError(refinementSteps)
      }
      const { stages, finalChunks } = await unified.refineChunks(
        args.query,
        chunkResultsToScored(args.chunks),
        k
      )
      return {
        stages: stages.map((s) => ({
          ...s,
          outputChunks: scoredToChunkResults(s.outputChunks)
        })),
        finalChunks: scoredToChunkResults(finalChunks)
      }
    } finally {
      unified.cleanup()
    }
  }
})

// ===========================================================================
// Retrieve With Trace (full pipeline, single action)
// ===========================================================================

/**
 * Execute the full retrieval pipeline and return all intermediate results:
 * `{ rewriting, search, refinement, finalChunks, totalLatencyMs }`.
 */
export const retrieveWithTrace = tenantAction({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
    k: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<RetrieveWithTraceResponse> => {
    const retriever: Doc<"retrievers"> = await ctx.runQuery(
      internal.kb.retrievers.getInternal,
      { id: args.retrieverId }
    )

    if (retriever.orgId !== ctx.orgId) {
      throw new Error("Retriever not found")
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
      )
    }

    const config = retriever.retrieverConfig as PipelineConfig
    const k = args.k ?? retriever.defaultK
    const searchConfig: SearchConfig = (config.search as
      | SearchConfig
      | undefined) ?? {
      strategy: "dense"
    }
    const refinementSteps =
      (config.refinement as RefinementStepConfig[] | undefined) ?? []
    const needsReranker = refinementSteps.some((s) => s.type === "rerank")

    if (
      needsReranker &&
      !(await rerankerAvailable(
        refinementSteps as unknown as Array<Record<string, unknown>>
      ))
    ) {
      throw rerankUnavailableError(refinementSteps)
    }

    const unified = await buildStatelessRetriever(ctx, {
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      retrieverConfig: config as unknown as Record<string, unknown>,
      qdrantCollection: retriever.qdrantCollection
    })
    try {
      const trace = await unified.retrieveWithTrace(args.query, k)
      const finalChunks = scoredToChunkResults(trace.finalChunks)
      return {
        rewriting: {
          strategy: trace.query.strategy,
          original: trace.query.original,
          rewrittenQueries: [...trace.query.queries],
          hypotheticalAnswer: trace.query.hypotheticalAnswer,
          latencyMs: trace.query.latencyMs
        },
        search: {
          searchConfig: buildSearchConfigMeta(searchConfig, k),
          perQueryResults: trace.search.perQueryResults.map((r) => ({
            query: r.query,
            chunks: scoredToChunkResults(r.chunks)
          })),
          fusedResults: scoredToChunkResults(
            trace.search.fusedResults.slice(0, k)
          ),
          latencyMs: trace.search.latencyMs
        },
        refinement: {
          stages: trace.refinement.map((s) => ({
            ...s,
            outputChunks: scoredToChunkResults(s.outputChunks)
          })),
          finalChunks,
          latencyMs: trace.refinement.reduce((sum, s) => sum + s.latencyMs, 0)
        },
        finalChunks,
        totalLatencyMs: trace.totalLatencyMs
      }
    } finally {
      unified.cleanup()
    }
  }
})
