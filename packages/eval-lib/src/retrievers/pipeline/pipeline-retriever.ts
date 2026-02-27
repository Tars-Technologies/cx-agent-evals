import type { Corpus, PositionAwareChunk } from "../../types/index.js";
import type { PositionAwareChunker } from "../../chunkers/chunker.interface.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { VectorStore } from "../../vector-stores/vector-store.interface.js";
import type { Reranker } from "../../rerankers/reranker.interface.js";
import { InMemoryVectorStore } from "../../vector-stores/in-memory.js";
import type { Retriever } from "../retriever.interface.js";
import {
  type PipelineConfig,
  type SearchConfig,
  type RefinementStepConfig,
  DEFAULT_SEARCH_CONFIG,
  computeIndexConfigHash,
} from "./config.js";
import { BM25SearchIndex } from "./search/bm25.js";
import type { ScoredChunk } from "./types.js";
import { weightedScoreFusion, reciprocalRankFusion } from "./search/fusion.js";
import { applyThresholdFilter } from "./refinement/threshold.js";

// ---------------------------------------------------------------------------
// Dependencies — runtime instances that can't be serialized in config
// ---------------------------------------------------------------------------

export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  /**
   * Number of chunks to embed per API call during the INDEX stage.
   * Increase for throughput when your embedding provider allows large
   * batches; decrease to stay within request-size or rate limits.
   * @default 100
   */
  readonly embeddingBatchSize?: number;
}

// ---------------------------------------------------------------------------
// PipelineRetriever
// ---------------------------------------------------------------------------

/**
 * A composable, config-driven retriever that executes a four-stage pipeline:
 *
 *   INDEX → QUERY → SEARCH → REFINEMENT
 *
 * The declarative {@link PipelineConfig} controls strategy selection and
 * parameters, while {@link PipelineRetrieverDeps} provides the runtime
 * instances (chunker, embedder, vector store, reranker).
 */
export class PipelineRetriever implements Retriever {
  readonly name: string;
  readonly indexConfigHash: string;

  private readonly _searchConfig: SearchConfig;
  private readonly _refinementSteps: readonly RefinementStepConfig[];
  private readonly _chunker: PositionAwareChunker;
  private readonly _embedder: Embedder;
  private readonly _vectorStore: VectorStore;
  private readonly _reranker: Reranker | undefined;
  private readonly _batchSize: number;

  private _bm25Index: BM25SearchIndex | null = null;
  private _initialized = false;

  constructor(config: PipelineConfig, deps: PipelineRetrieverDeps) {
    this.name = config.name;
    this.indexConfigHash = computeIndexConfigHash(config);

    this._searchConfig = config.search ?? DEFAULT_SEARCH_CONFIG;
    this._refinementSteps = config.refinement ?? [];

    this._chunker = deps.chunker;
    this._embedder = deps.embedder;
    this._vectorStore = deps.vectorStore ?? new InMemoryVectorStore();
    this._reranker = deps.reranker;
    this._batchSize = deps.embeddingBatchSize ?? 100;

    // Validate: rerank step requires a reranker dependency
    const hasRerankStep = this._refinementSteps.some((s) => s.type === "rerank");
    if (hasRerankStep && !this._reranker) {
      throw new Error(
        'PipelineRetriever: refinement includes "rerank" step but no reranker was provided in deps.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // INDEX stage
  // -------------------------------------------------------------------------

  async init(corpus: Corpus): Promise<void> {
    const chunks: PositionAwareChunk[] = [];

    for (const doc of corpus.documents) {
      chunks.push(...this._chunker.chunkWithPositions(doc));
    }

    // Embed and store in vector store (needed for "dense" and "hybrid")
    if (this._searchConfig.strategy !== "bm25") {
      for (let i = 0; i < chunks.length; i += this._batchSize) {
        const batch = chunks.slice(i, i + this._batchSize);
        const embeddings = await this._embedder.embed(batch.map((c) => c.content));
        await this._vectorStore.add(batch, embeddings);
      }
    }

    // Build BM25 index (needed for "bm25" and "hybrid")
    if (this._searchConfig.strategy === "bm25" || this._searchConfig.strategy === "hybrid") {
      const bm25Config = { k1: this._searchConfig.k1, b: this._searchConfig.b };

      this._bm25Index = new BM25SearchIndex(bm25Config);
      this._bm25Index.build(chunks);
    }

    this._initialized = true;
  }

  // -------------------------------------------------------------------------
  // QUERY + SEARCH + REFINEMENT stages
  // -------------------------------------------------------------------------

  async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
    if (!this._initialized) {
      throw new Error("PipelineRetriever not initialized. Call init() first.");
    }

    // QUERY stage — identity passthrough (future: HyDE, multi-query)
    const processedQuery = query;

    // SEARCH stage
    let scoredResults: ScoredChunk[];

    switch (this._searchConfig.strategy) {
      case "dense":
        scoredResults = await this._searchDense(processedQuery, k);
        break;

      case "bm25":
        scoredResults = this._searchBM25(processedQuery, k);
        break;

      case "hybrid":
        scoredResults = await this._searchHybrid(processedQuery, k);
        break;

      default:
        throw new Error(`Unknown search strategy: ${(this._searchConfig as any).strategy}`);
    }

    // REFINEMENT stage
    scoredResults = await this._applyRefinements(processedQuery, scoredResults, k);

    return scoredResults.slice(0, k).map(({ chunk }) => chunk);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    await this._vectorStore.clear();
    if (this._bm25Index) {
      this._bm25Index.clear();
      this._bm25Index = null;
    }
    this._initialized = false;
  }

  // -------------------------------------------------------------------------
  // Search strategy implementations
  // -------------------------------------------------------------------------

  private async _searchDense(query: string, k: number): Promise<ScoredChunk[]> {
    const queryEmbedding = await this._embedder.embedQuery(query);
    const chunks = await this._vectorStore.search(queryEmbedding, k);

    // VectorStore returns chunks sorted by similarity but without scores.
    // Assign linearly decaying scores for rank-based normalization.
    return assignRankScores(chunks);
  }

  private _searchBM25(query: string, k: number): ScoredChunk[] {
    if (!this._bm25Index) {
      return [];
    }
    return [...this._bm25Index.searchWithScores(query, k)];
  }

  private async _searchHybrid(query: string, k: number): Promise<ScoredChunk[]> {
    const config = this._searchConfig;
    if (config.strategy !== "hybrid") return [];

    const candidateK = k * (config.candidateMultiplier ?? 4);

    // Run dense + BM25 in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this._searchDense(query, candidateK),
      Promise.resolve(this._searchBM25(query, candidateK)),
    ]);

    const fusionMethod = config.fusionMethod ?? "weighted";

    if (fusionMethod === "rrf") {
      return reciprocalRankFusion({
        denseResults,
        sparseResults,
        k: config.rrfK,
      });
    }

    return weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: config.denseWeight ?? 0.7,
      sparseWeight: config.sparseWeight ?? 0.3,
    });
  }

  // -------------------------------------------------------------------------
  // Refinement chain
  // -------------------------------------------------------------------------

  private async _applyRefinements(
    query: string,
    results: ScoredChunk[],
    k: number,
  ): Promise<ScoredChunk[]> {
    let current = results;

    for (const step of this._refinementSteps) {
      switch (step.type) {
        case "rerank": {
          const chunks = current.map(({ chunk }) => chunk);
          const reranked = await this._reranker!.rerank(query, chunks, k);
          current = assignRankScores(reranked);
          break;
        }

        case "threshold": {
          current = applyThresholdFilter(current, step.minScore);
          break;
        }

        default:
          throw new Error(`Unknown refinement step type: ${(step as any).type}`);
      }
    }

    return current;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Assigns linearly decaying scores based on position.
 * First result gets 1.0, last gets 1/count.
 */
function assignRankScores(chunks: readonly PositionAwareChunk[]): ScoredChunk[] {
  const count = chunks.length;
  if (count === 0) return [];
  return chunks.map((chunk, i) => ({
    chunk,
    score: (count - i) / count,
  }));
}
