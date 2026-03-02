import type { PositionAwareChunk } from "../types/index.js";

/**
 * Re-scores and re-orders candidate chunks using a cross-encoder or similar model
 * that considers the query-chunk pair jointly, typically yielding higher relevance
 * accuracy than embedding-only similarity.
 */
export interface Reranker {
  /** Human-readable identifier (e.g., "cohere-rerank-v3"). */
  readonly name: string;

  /**
   * Re-rank candidate chunks by relevance to the query.
   * @param query - The user query to score against.
   * @param chunks - Candidate chunks from an initial retrieval pass.
   * @param topK - Maximum number of chunks to return (defaults to all).
   * @returns Chunks sorted by descending relevance, truncated to `topK`.
   */
  rerank(
    query: string,
    chunks: readonly PositionAwareChunk[],
    topK?: number,
  ): Promise<PositionAwareChunk[]>;
}
