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
  type Embedder,
  makeVectorStore,
  type PipelineLLM,
  PositionAwareChunkId,
  type Reranker,
  type ScoredChunk,
  StatelessQueryRetriever,
  type VectorSearchResult,
  type VectorStore
} from "@tars-inc/eval-lib"
import { createEmbedder } from "@tars-inc/eval-lib/llm"
import { parentSwap } from "@tars-inc/eval-lib/utils/parent-swap"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { backendConfig } from "../config"
import { vectorSearchWithFilter } from "../lib/vectorSearch"
import { assertIndexableDimension } from "./dimension_guard"
import { resolveRerankerSelection } from "./reranker_selection"
import { qdrantCollectionNameFor, resolveVectorBackend } from "./vector_backend"

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
  return makeVectorStore(
    { backend: "native" },
    {
      native: {
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
      }
    }
  )
}

/**
 * Qdrant-backed VectorStore for an index whose config selects the qdrant
 * backend. Fails loudly when the deployment has no QDRANT_URL configured.
 */
export function buildQdrantStore(opts: {
  collection: string
  dimension: number
}): VectorStore {
  const qdrant = backendConfig.qdrant
  if (!qdrant) {
    throw new Error(
      "This index is configured for the Qdrant vector store, but QDRANT_URL " +
        "is not set in the deployment environment. Set QDRANT_URL (and " +
        "QDRANT_API_KEY if required), restart the Convex worker, and retry."
    )
  }
  return makeVectorStore({
    backend: "qdrant",
    url: qdrant.url,
    apiKey: qdrant.apiKey,
    collection: opts.collection,
    dimension: opts.dimension
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
      const docs: Array<{ docId: string; content: string }> =
        await ctx.runQuery(internal.kb.documents.listByKbInternal, {
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

/**
 * Parent-child swap over an external (Qdrant) store: replace child results
 * with their Convex parent chunk rows, mirroring the native swap semantics in
 * lib/vectorSearch.ts (first-seen child's score, dedupe parents, fall back to
 * the child when the parent row is missing).
 */
export function wrapWithParentSwap(
  ctx: ActionCtx,
  inner: VectorStore,
  kbId: Id<"knowledgeBases">
): VectorStore {
  return new CallbackVectorStore({
    name: `${inner.name}+parent-swap`,
    search: async (queryEmbedding, opts) => {
      const children = await inner.search(queryEmbedding, opts)
      const parentIds = [
        ...new Set(
          children
            .map((r) => r.chunk.metadata?.parentChunkId as string | undefined)
            .filter((id): id is string => Boolean(id))
        )
      ]
      if (parentIds.length === 0) return children
      // Parent ids come from the Qdrant payload (external store), so scope the
      // lookup to this KB: a poisoned/foreign parent id must not surface another
      // tenant's chunk content here.
      const parents: Array<{
        _id: unknown
        chunkId: string
        content: string
        documentId: Id<"documents">
        start: number
        end: number
        metadata?: Record<string, unknown>
      }> = await ctx.runQuery(internal.kb.chunks.fetchChunksByIds, {
        ids: parentIds as unknown as Id<"documentChunks">[],
        kbId
      })
      const docIdMap: Record<string, string> = await ctx.runQuery(
        internal.kb.chunks.fetchDocIdMap,
        { documentIds: [...new Set(parents.map((p) => p.documentId))] }
      )
      const parentMap = new Map(parents.map((p) => [String(p._id), p]))
      return parentSwap(children, {
        getParentId: (child) =>
          child.chunk.metadata?.parentChunkId as string | undefined,
        getParent: (parentId) => parentMap.get(parentId),
        fromParent: (parent, child) => ({
          chunk: {
            id: PositionAwareChunkId(parent.chunkId),
            content: parent.content,
            docId: DocumentId(
              docIdMap[String(parent.documentId)] ?? String(child.chunk.docId)
            ),
            start: parent.start,
            end: parent.end,
            metadata: parent.metadata ?? {}
          },
          score: child.score
        }),
        keepChild: (child) => child
      })
    }
  })
}

export interface BuildRetrieverOpts {
  readonly kbId: Id<"knowledgeBases">
  readonly indexConfigHash: string
  readonly retrieverConfig: Record<string, unknown>
  readonly preloadedCorpus?: Corpus
  /** Stored on the retriever at creation; falls back to the computed name. */
  readonly qdrantCollection?: string
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
  // Leave undefined so each embedder factory applies its per-provider
  // default model, matching what indexDocument does at index time.
  const embeddingModel = indexSettings.embeddingModel as string | undefined
  const indexStrategy = (indexSettings.strategy as string) ?? "plain"
  const refinementSteps = Array.isArray(opts.retrieverConfig.refinement)
    ? (opts.retrieverConfig.refinement as Array<Record<string, unknown>>)
    : []

  const vectorBackend = resolveVectorBackend(indexSettings.vectorBackend)

  let embedder: Embedder
  if (vectorBackend === "qdrant") {
    const { makeEmbedder } = await import(
      "@tars-inc/eval-lib/embedders/make-embedder"
    )
    embedder = await makeEmbedder({
      provider: ((indexSettings.embeddingProvider as string) ??
        "openai") as never,
      model: embeddingModel
    })
  } else {
    embedder = createEmbedder(embeddingModel)
    assertIndexableDimension(embedder.dimension, embeddingModel)
  }

  const baseStore =
    vectorBackend === "qdrant"
      ? buildQdrantStore({
          // Fallback only for the legacy experiment path (no stored name). The
          // name-time model default lives in qdrantCollectionNameFor and must
          // agree with the embedder factory's default used just above.
          collection:
            opts.qdrantCollection ?? qdrantCollectionNameFor(indexSettings),
          dimension: embedder.dimension
        })
      : buildNativeVectorStore(ctx, {
          kbId: opts.kbId,
          indexConfigHash: opts.indexConfigHash,
          indexStrategy
        })

  const vectorStore =
    vectorBackend === "qdrant" && indexStrategy === "parent-child"
      ? wrapWithParentSwap(ctx, baseStore, opts.kbId)
      : baseStore

  const llm = await buildQueryLLM(
    opts.retrieverConfig.query as Record<string, unknown> | undefined
  )
  const reranker = refinementSteps.some((s) => s.type === "rerank")
    ? await buildRerankerFromSteps(refinementSteps)
    : undefined

  return new StatelessQueryRetriever({
    config: opts.retrieverConfig as never,
    vectorStore,
    chunkSource: buildConvexChunkSource(ctx, {
      kbId: opts.kbId,
      indexConfigHash: opts.indexConfigHash,
      preloadedCorpus: opts.preloadedCorpus
    }),
    embedder,
    llm,
    reranker,
    // Shared Qdrant collection: search MUST filter by kbId + indexConfigHash
    // for tenant/config isolation. kbId is also load-bearing for correctness -
    // the collection uses HNSW m=0 (per-tenant subgraphs), so an unfiltered
    // query has no graph to traverse. Never drop it. The native store ignores
    // this filter and scopes via its own captured options.
    filter: {
      kbId: String(opts.kbId),
      indexConfigHash: opts.indexConfigHash
    }
  })
}
