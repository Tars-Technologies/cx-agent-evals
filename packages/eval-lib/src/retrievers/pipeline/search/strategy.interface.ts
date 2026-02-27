import type { PositionAwareChunk } from "../../../types/chunks.js";
import type { Embedder } from "../../../embedders/embedder.interface.js";
import type { VectorStore } from "../../../vector-stores/vector-store.interface.js";
import type { ScoredChunk } from "../types.js";

/**
 * Runtime dependencies passed to search strategies.
 *
 * Strategies receive these as parameters rather than holding references
 * themselves so that the PipelineRetriever remains the single owner of
 * shared instances (embedder, vector store).
 */
export interface SearchStrategyDeps {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore;
}

/**
 * Strategy-pattern interface for the SEARCH stage of the pipeline.
 *
 * Each implementation encapsulates one search approach (dense, BM25, hybrid)
 * and exposes a uniform lifecycle: `init` → `search` → `cleanup`.
 */
export interface SearchStrategy {
  /** Human-readable strategy name (e.g. "dense", "bm25", "hybrid"). */
  readonly name: string;

  /**
   * Initialise any internal data structures required for search.
   *
   * For dense search this means embedding and storing chunks in the vector
   * store; for BM25 it means building the inverted index.
   */
  init(chunks: readonly PositionAwareChunk[], deps: SearchStrategyDeps): Promise<void>;

  /**
   * Execute a search and return scored chunks, ordered by descending score.
   */
  search(query: string, k: number, deps: SearchStrategyDeps): Promise<ScoredChunk[]>;

  /**
   * Release all resources held by this strategy.
   */
  cleanup(deps: SearchStrategyDeps): Promise<void>;
}
