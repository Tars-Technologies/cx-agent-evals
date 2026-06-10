"use node"

/**
 * Shared retrieval runtime builders: the eval-lib VectorStore seam over
 * Convex-native vector search. Carries "use node" because it imports the
 * eval-lib main barrel, whose transitive graph reaches Node-only built-ins
 * (crypto, fs/promises). Imported ONLY by "use node" action files
 * (retrieve_actions, experiment_actions, pipeline_actions); it registers no
 * Convex functions, only plain helpers.
 */
import {
  CallbackVectorStore,
  type ChunkSource,
  type Corpus,
  createCorpusFromDocuments,
  DocumentId,
  type PipelineLLM,
  PositionAwareChunkId,
  type Reranker,
  type ScoredChunk,
  StatelessQueryRetriever,
  type VectorSearchResult,
  type VectorStore
} from "@tars-inc/eval-lib"
import { createEmbedder } from "@tars-inc/eval-lib/llm"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { backendConfig } from "../config"
import { vectorSearchWithFilter } from "../lib/vectorSearch"
import { assertIndexableDimension } from "./dimension_guard"
import { resolveRerankerSelection } from "./reranker_selection"

/** Convert raw Convex chunk rows + the vector-search score map to results. */
export function rawChunksToResults(
  rows: ReadonlyArray<{
    _id: unknown
    chunkId: string
    content: string
    docId: string
    start: number
    end: number
    metadata?: Record<string, unknown>
  }>,
  scoreMap: ReadonlyMap<string, number>
): VectorSearchResult[] {
  return rows.map((c) => ({
    chunk: {
      id: PositionAwareChunkId(c.chunkId),
      content: c.content,
      docId: DocumentId(c.docId),
      start: c.start,
      end: c.end,
      metadata: c.metadata ?? {}
    },
    score: scoreMap.get(String(c._id)) ?? 0
  }))
}

export interface NativeVectorStoreOpts {
  readonly kbId: Id<"knowledgeBases">
  readonly indexConfigHash: string
  /** "plain" | "parent-child" - drives the parent swap inside native search. */
  readonly indexStrategy?: string
}

/**
 * Native Convex VectorStore: search wraps vectorSearchWithFilter (including
 * its indexConfigHash post-filter and parent-child swap); deletes wrap the
 * existing chunk mutations. `add` is intentionally NOT provided - ingestion
 * stays on the two-phase indexing mutations.
 */
export function buildNativeVectorStore(
  ctx: ActionCtx,
  opts: NativeVectorStoreOpts
): VectorStore {
  return new CallbackVectorStore({
    name: "convex-native",
    search: async (queryEmbedding, searchOpts) => {
      const { chunks, scoreMap } = await vectorSearchWithFilter(ctx, {
        queryEmbedding: [...queryEmbedding],
        kbId: opts.kbId,
        indexConfigHash: opts.indexConfigHash,
        topK: searchOpts.k,
        indexStrategy: opts.indexStrategy
      })
      return rawChunksToResults(chunks, scoreMap)
    }
  })
}

/** Response/result row shape shared with pipeline_actions' ChunkResult. */
export interface ChunkResultShape {
  readonly chunkId: string
  readonly content: string
  readonly docId: string
  readonly start: number
  readonly end: number
  readonly score: number
  readonly metadata: Record<string, unknown>
}

export function scoredToChunkResults(
  scored: readonly ScoredChunk[]
): ChunkResultShape[] {
  return scored.map(({ chunk, score }) => ({
    chunkId: String(chunk.id),
    content: chunk.content,
    docId: String(chunk.docId),
    start: chunk.start,
    end: chunk.end,
    score,
    metadata: (chunk.metadata ?? {}) as Record<string, unknown>
  }))
}

export function chunkResultsToScored(
  rows: readonly ChunkResultShape[]
): ScoredChunk[] {
  return rows.map((c) => ({
    chunk: {
      id: PositionAwareChunkId(c.chunkId),
      content: c.content,
      docId: DocumentId(c.docId),
      start: c.start,
      end: c.end,
      metadata: c.metadata ?? {}
    },
    score: c.score
  }))
}

/** Chunk + corpus access over Convex queries. */
export function buildConvexChunkSource(
  ctx: ActionCtx,
  opts: {
    kbId: Id<"knowledgeBases">
    indexConfigHash: string
    /** Reuse a corpus the caller already loaded (experiments). */
    preloadedCorpus?: Corpus
  }
): ChunkSource {
  return {
    listChunks: async () => {
      const all: Array<{
        chunkId: string
        content: string
        docId: string
        start: number
        end: number
        metadata: Record<string, unknown>
      }> = []
      let cursor: string | null = null
      let done = false
      while (!done) {
        const page: {
          chunks: Array<{
            chunkId: string
            content: string
            docId: string
            start: number
            end: number
            metadata: Record<string, unknown>
          }>
          isDone: boolean
          continueCursor: string
        } = await ctx.runQuery(internal.kb.chunks.getChunksByKbConfigPage, {
          kbId: opts.kbId,
          indexConfigHash: opts.indexConfigHash,
          cursor
        })
        all.push(...page.chunks)
        done = page.isDone
        cursor = page.continueCursor
      }
      const seen = new Set<string>()
      const result = []
      for (const c of all) {
        if (seen.has(c.chunkId)) continue
        seen.add(c.chunkId)
        result.push({
          id: PositionAwareChunkId(c.chunkId),
          content: c.content,
          docId: DocumentId(c.docId),
          start: c.start,
          end: c.end,
          metadata: c.metadata
        })
      }
      return result
    },
    getCorpus: async () => {
      if (opts.preloadedCorpus) return opts.preloadedCorpus
      const docs = await ctx.runQuery(internal.kb.documents.listByKbInternal, {
        kbId: opts.kbId
      })
      return createCorpusFromDocuments(
        docs.map((d) => ({ id: d.docId, content: d.content }))
      )
    }
  }
}

const LLM_STRATEGIES = ["hyde", "multi-query", "step-back", "rewrite"]

export async function buildQueryLLM(
  queryConfig: Record<string, unknown> | undefined
): Promise<PipelineLLM | undefined> {
  const strategy = (queryConfig?.strategy as string) ?? "identity"
  if (!LLM_STRATEGIES.includes(strategy)) return undefined
  const { OpenAIPipelineLLM } = await import(
    "@tars-inc/eval-lib/pipeline/llm-openai"
  )
  return OpenAIPipelineLLM.create({ model: "gpt-4o-mini" })
}

/**
 * Build the reranker selected on the rerank refinement step. Returns
 * undefined (graceful skip) when no rerank step is configured, the provider
 * is unknown, the key is missing, or construction fails. Callers that must
 * fail loudly (the stage playground) check rerankerAvailable themselves.
 */
export async function buildRerankerFromSteps(
  refinementSteps: ReadonlyArray<Record<string, unknown>>
): Promise<Reranker | undefined> {
  const selection = resolveRerankerSelection(refinementSteps, backendConfig.ai)
  if (!selection) return undefined
  try {
    const { makeReranker } = await import(
      "@tars-inc/eval-lib/rerankers/make-reranker"
    )
    return await makeReranker(selection)
  } catch (err) {
    console.warn("[Reranker] failed to construct reranker, skipping", err)
    return undefined
  }
}

/** True when the rerank steps resolve to a usable provider + key. */
export async function rerankerAvailable(
  refinementSteps: ReadonlyArray<Record<string, unknown>>
): Promise<boolean> {
  return (
    resolveRerankerSelection(refinementSteps, backendConfig.ai) !== undefined
  )
}

export interface BuildRetrieverOpts {
  readonly kbId: Id<"knowledgeBases">
  readonly indexConfigHash: string
  readonly retrieverConfig: Record<string, unknown>
  readonly preloadedCorpus?: Corpus
}

/** Compose the unified retriever from a retriever/experiment config. */
export async function buildStatelessRetriever(
  ctx: ActionCtx,
  opts: BuildRetrieverOpts
): Promise<StatelessQueryRetriever> {
  const indexSettings = (opts.retrieverConfig.index ?? {}) as Record<
    string,
    unknown
  >
  const embeddingModel =
    (indexSettings.embeddingModel as string) ?? "text-embedding-3-small"
  const indexStrategy = (indexSettings.strategy as string) ?? "plain"
  const refinementSteps = Array.isArray(opts.retrieverConfig.refinement)
    ? (opts.retrieverConfig.refinement as Array<Record<string, unknown>>)
    : []

  const embedder = createEmbedder(embeddingModel)
  assertIndexableDimension(embedder.dimension, embeddingModel)
  const llm = await buildQueryLLM(
    opts.retrieverConfig.query as Record<string, unknown> | undefined
  )
  const reranker = refinementSteps.some((s) => s.type === "rerank")
    ? await buildRerankerFromSteps(refinementSteps)
    : undefined

  return new StatelessQueryRetriever({
    config: opts.retrieverConfig as never,
    vectorStore: buildNativeVectorStore(ctx, {
      kbId: opts.kbId,
      indexConfigHash: opts.indexConfigHash,
      indexStrategy
    }),
    chunkSource: buildConvexChunkSource(ctx, {
      kbId: opts.kbId,
      indexConfigHash: opts.indexConfigHash,
      preloadedCorpus: opts.preloadedCorpus
    }),
    embedder,
    llm,
    reranker,
    filter: {
      kbId: String(opts.kbId),
      indexConfigHash: opts.indexConfigHash
    }
  })
}
