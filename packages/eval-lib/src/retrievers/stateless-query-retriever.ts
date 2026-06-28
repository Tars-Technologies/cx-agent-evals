import type { Embedder } from "../embedders/embedder.interface.js"
import type { Reranker } from "../rerankers/reranker.interface.js"
import type { Corpus } from "../types/documents.js"
import type { PositionAwareChunk } from "../types/index.js"
import type {
  VectorFilter,
  VectorStore
} from "../vector-stores/vector-store.interface.js"
import { assertVectorSearchResults } from "../vector-stores/vector-store.interface.js"
import type { ChunkSource } from "./chunk-source.interface.js"
import type { PipelineConfig, RefinementStepConfig } from "./pipeline/config.js"
import {
  applyDedup,
  applyExpandContext,
  applyMmr,
  applyThresholdFilter,
  assignRankScores,
  BM25SearchIndex,
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  reciprocalRankFusion,
  rrfFuseMultiple,
  weightedScoreFusion
} from "./pipeline/index.js"
import type { PipelineLLM } from "./pipeline/llm.interface.js"
import { parseVariants } from "./pipeline/query/index.js"
import type { ScoredChunk } from "./pipeline/types.js"

// ── Trace types ────────────────────────────────────────────────────────────

export interface QueryStageTrace {
  readonly strategy: string
  readonly original: string
  readonly queries: readonly string[]
  readonly hypotheticalAnswer?: string
  readonly latencyMs: number
}

export interface SearchStageTrace {
  readonly strategy: string
  readonly perQueryResults: ReadonlyArray<{
    readonly query: string
    readonly chunks: readonly ScoredChunk[]
  }>
  readonly fusedResults: readonly ScoredChunk[]
  readonly latencyMs: number
}

export interface RefinementStageTrace {
  readonly name: string
  readonly config: Record<string, unknown>
  readonly inputCount: number
  readonly outputCount: number
  readonly outputChunks: readonly ScoredChunk[]
  readonly latencyMs: number
}

export interface RetrievalTrace {
  readonly query: QueryStageTrace
  readonly search: SearchStageTrace
  readonly refinement: readonly RefinementStageTrace[]
  /** Refinement output (search output when no refinement). NOT sliced to k. */
  readonly finalChunks: readonly ScoredChunk[]
  readonly totalLatencyMs: number
}

// ── Deps ──────────────────────────────────────────────────────────────────

export interface StatelessQueryRetrieverDeps {
  readonly config: PipelineConfig
  readonly vectorStore: VectorStore
  readonly chunkSource: ChunkSource
  readonly embedder: Embedder
  readonly reranker?: Reranker
  readonly llm?: PipelineLLM
  /** Scope passed to vectorStore.search and chunkSource calls. */
  readonly filter: VectorFilter
}

/**
 * Query-time retrieval pipeline over a pre-built index: query expansion →
 * dense/BM25/hybrid search → refinement chain. "Stateless" = no init(corpus);
 * all indexed state is reached through the injected VectorStore/ChunkSource.
 * Every stage is traced so callers can render per-stage results.
 */
export class StatelessQueryRetriever {
  private readonly _deps: StatelessQueryRetrieverDeps
  // Memoize the build *promise* (not just the result): concurrent multi-query
  // searches race into the lazy build via Promise.all, and caching only the
  // resolved index would let each racer fetch the corpus and rebuild.
  private _bm25Promise: Promise<BM25SearchIndex> | null = null
  private _corpus: Corpus | null = null

  constructor(deps: StatelessQueryRetrieverDeps) {
    this._deps = deps
  }

  // ── Stage 1: query expansion ────────────────────────────────────────────

  async expandQuery(query: string): Promise<QueryStageTrace> {
    const start = performance.now()
    const cfg = (this._deps.config.query ?? { strategy: "identity" }) as Record<
      string,
      unknown
    > & { strategy: string }
    const llm = this._deps.llm
    const done = (
      queries: readonly string[],
      hypotheticalAnswer?: string
    ): QueryStageTrace => {
      // Trim each expanded query and drop empties; if a transform yields nothing
      // usable (empty LLM output, variants parsed to nothing, unknown strategy)
      // fall back to the original so at least one non-empty query always reaches
      // search. Mirrors PipelineRetriever._processQuery so the two paths agree.
      const normalized = queries.map((q) => q.trim()).filter((q) => q.length > 0)
      return {
        strategy: cfg.strategy,
        original: query,
        queries: normalized.length > 0 ? normalized : [query],
        hypotheticalAnswer,
        latencyMs: Math.round(performance.now() - start)
      }
    }

    if (cfg.strategy === "identity" || !llm) return done([query])

    switch (cfg.strategy) {
      case "hyde": {
        const prompt = (cfg.hydePrompt as string) ?? DEFAULT_HYDE_PROMPT
        const n = (cfg.numHypotheticalDocs as number) ?? 1
        const docs = await Promise.all(
          Array.from({ length: n }, () => llm.complete(prompt + query))
        )
        return done(docs, docs[0])
      }
      case "multi-query": {
        const n = (cfg.numQueries as number) ?? 3
        const prompt = (
          (cfg.generationPrompt as string) ?? DEFAULT_MULTI_QUERY_PROMPT
        ).replace("{n}", String(n))
        const variants = await llm.complete(prompt + query)
        return done(parseVariants(variants, n))
      }
      case "step-back": {
        const prompt =
          (cfg.stepBackPrompt as string) ?? DEFAULT_STEP_BACK_PROMPT
        const abstract = (await llm.complete(prompt + query)).trim()
        return done(
          cfg.includeOriginal !== false ? [query, abstract] : [abstract]
        )
      }
      case "rewrite": {
        const prompt = (cfg.rewritePrompt as string) ?? DEFAULT_REWRITE_PROMPT
        return done([(await llm.complete(prompt + query)).trim()])
      }
      default:
        return done([query])
    }
  }

  // ── Stage 2: search ─────────────────────────────────────────────────────

  async searchQueries(
    queries: readonly string[],
    k: number
  ): Promise<SearchStageTrace> {
    const start = performance.now()
    const searchCfg = (this._deps.config.search ?? {
      strategy: "dense"
    }) as Record<string, unknown> & { strategy: string }

    const perQueryK = queries.length > 1 ? k * 2 : k
    const perQueryResults = await Promise.all(
      queries.map(async (q) => ({
        query: q,
        chunks: await this._searchSingle(q, perQueryK, searchCfg)
      }))
    )

    const fusedResults =
      perQueryResults.length === 1
        ? perQueryResults[0].chunks
        : rrfFuseMultiple(perQueryResults.map((r) => r.chunks))

    return {
      strategy: searchCfg.strategy,
      perQueryResults,
      fusedResults,
      latencyMs: Math.round(performance.now() - start)
    }
  }

  private async _searchSingle(
    query: string,
    k: number,
    cfg: Record<string, unknown> & { strategy: string }
  ): Promise<ScoredChunk[]> {
    switch (cfg.strategy) {
      case "bm25":
        return this._keywordSearch(query, k, cfg)
      case "hybrid": {
        const candidateK = k * ((cfg.candidateMultiplier as number) ?? 4)
        const [denseResults, sparseResults] = await Promise.all([
          this._denseSearch(query, candidateK),
          this._keywordSearch(query, candidateK, cfg)
        ])
        const fused =
          cfg.fusionMethod === "rrf"
            ? reciprocalRankFusion({
                denseResults,
                sparseResults,
                k: cfg.rrfK as number | undefined
              })
            : weightedScoreFusion({
                denseResults,
                sparseResults,
                denseWeight: (cfg.denseWeight as number) ?? 0.7,
                sparseWeight: (cfg.sparseWeight as number) ?? 0.3
              })
        return fused.slice(0, k)
      }
      default:
        return this._denseSearch(query, k)
    }
  }

  private async _denseSearch(query: string, k: number): Promise<ScoredChunk[]> {
    const queryEmbedding = await this._deps.embedder.embedQuery(query)
    const results = await this._deps.vectorStore.search(queryEmbedding, {
      k,
      filter: this._deps.filter
    })
    assertVectorSearchResults(results)
    return results.map(({ chunk, score }) => ({ chunk, score }))
  }

  /**
   * Keyword (BM25) search. When the injected store maintains a sparse index
   * (`supportsSparse`), the store does the keyword search server-side via
   * `searchSparse` — corpus-independent, no per-query rebuild. Otherwise this
   * falls back to the in-memory MiniSearch index built from the full corpus
   * (cx-agent, CI, and any non-Qdrant backend keep working exactly as before).
   */
  private async _keywordSearch(
    query: string,
    k: number,
    cfg: Record<string, unknown>
  ): Promise<ScoredChunk[]> {
    if (this._deps.vectorStore.supportsSparse) {
      const results = await this._deps.vectorStore.searchSparse(query, {
        k,
        filter: this._deps.filter
      })
      assertVectorSearchResults(results, "VectorStore.searchSparse")
      return results.map(({ chunk, score }) => ({ chunk, score }))
    }
    const bm25 = await this._getBm25(cfg)
    return [...bm25.searchWithScores(query, k)]
  }

  private _getBm25(cfg: Record<string, unknown>): Promise<BM25SearchIndex> {
    if (!this._bm25Promise) {
      const k1 = cfg.k1 as number | undefined
      const b = cfg.b as number | undefined
      this._bm25Promise = (async () => {
        const chunks = await this._deps.chunkSource.listChunks(
          this._deps.filter
        )
        const bm25 = new BM25SearchIndex({ k1, b })
        bm25.build(chunks)
        return bm25
      })()
    }
    return this._bm25Promise
  }

  // ── Stage 3: refinement ─────────────────────────────────────────────────

  async refineChunks(
    originalQuery: string,
    chunks: readonly ScoredChunk[],
    k: number
  ): Promise<{
    stages: RefinementStageTrace[]
    finalChunks: readonly ScoredChunk[]
  }> {
    const steps = this._deps.config.refinement ?? []
    let current: readonly ScoredChunk[] = chunks
    const stages: RefinementStageTrace[] = []

    for (const step of steps) {
      const stage = await this._runRefinementStep(
        step,
        originalQuery,
        current,
        k
      )
      stages.push(stage)
      current = stage.outputChunks
    }
    return { stages, finalChunks: current }
  }

  private async _runRefinementStep(
    step: RefinementStepConfig,
    originalQuery: string,
    chunks: readonly ScoredChunk[],
    k: number
  ): Promise<RefinementStageTrace> {
    const start = performance.now()
    const inputCount = chunks.length
    let outputChunks: readonly ScoredChunk[]
    let config: Record<string, unknown>

    switch (step.type) {
      case "rerank": {
        const topN = step.topN ?? k
        if (!this._deps.reranker) {
          config = { type: "rerank", skipped: true }
          outputChunks = chunks
          break
        }
        config = {
          type: "rerank",
          provider: step.provider ?? "cohere",
          model: step.model ?? "(provider default)",
          topK: topN
        }
        const reranked = await this._deps.reranker.rerank(
          originalQuery,
          chunks.map(({ chunk }) => chunk),
          topN
        )
        outputChunks = assignRankScores(reranked)
        break
      }
      case "threshold":
        config = { type: "threshold", minScore: step.minScore }
        outputChunks = applyThresholdFilter([...chunks], step.minScore ?? 0)
        break
      case "dedup": {
        const method = step.method ?? "overlap"
        const overlapThreshold = step.overlapThreshold ?? 0.5
        config = { type: "dedup", method, overlapThreshold }
        outputChunks = applyDedup([...chunks], method, overlapThreshold)
        break
      }
      case "mmr": {
        const lambda = step.lambda ?? 0.7
        config = { type: "mmr", lambda, k }
        outputChunks = applyMmr([...chunks], k, lambda)
        break
      }
      case "expand-context": {
        const windowChars = step.windowChars ?? 500
        config = { type: "expand-context", windowChars }
        if (!this._corpus) {
          this._corpus = await this._deps.chunkSource.getCorpus(
            this._deps.filter
          )
        }
        outputChunks = applyExpandContext(
          [...chunks],
          this._corpus,
          windowChars
        )
        break
      }
    }

    return {
      name: step.type,
      config,
      inputCount,
      outputCount: outputChunks.length,
      outputChunks,
      latencyMs: Math.round(performance.now() - start)
    }
  }

  // ── Composed entry points ───────────────────────────────────────────────

  async retrieveWithTrace(query: string, k: number): Promise<RetrievalTrace> {
    const start = performance.now()
    const queryTrace = await this.expandQuery(query)
    const searchTrace = await this.searchQueries(queryTrace.queries, k)
    const { stages, finalChunks } = await this.refineChunks(
      query,
      searchTrace.fusedResults,
      k
    )
    return {
      query: queryTrace,
      search: searchTrace,
      refinement: stages,
      finalChunks,
      totalLatencyMs: Math.round(performance.now() - start)
    }
  }

  async retrieveScored(query: string, k: number): Promise<ScoredChunk[]> {
    const trace = await this.retrieveWithTrace(query, k)
    return trace.finalChunks.slice(0, k).map(({ chunk, score }) => ({
      chunk,
      score
    }))
  }

  async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
    return (await this.retrieveScored(query, k)).map(({ chunk }) => chunk)
  }

  /** Release the lazily built BM25 index and cached corpus. */
  cleanup(): void {
    // Drop the memoized build so the next use rebuilds; clear the underlying
    // index once any in-flight build settles to free its memory.
    const pending = this._bm25Promise
    this._bm25Promise = null
    pending?.then((bm25) => bm25.clear()).catch(() => {})
    this._corpus = null
  }
}
