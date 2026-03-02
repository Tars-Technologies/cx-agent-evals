import type { PositionAwareChunk } from "../types/index.js";

/** A chunk paired with its cosine-similarity score from vector search. */
export interface VectorSearchResult {
  readonly chunk: PositionAwareChunk;
  /** Similarity score in [0, 1] where higher means more similar. */
  readonly score: number;
}

/**
 * Stores position-aware chunk embeddings and supports approximate nearest-neighbor search.
 * Chunks retain their character offsets so search results can be evaluated directly
 * against ground-truth spans without a separate offset-resolution step.
 */
export interface VectorStore {
  /** Human-readable identifier (e.g., "in-memory", "chroma"). */
  readonly name: string;

  /**
   * Insert chunks and their corresponding embedding vectors into the store.
   * @param chunks - Chunks to index; must be the same length as `embeddings`.
   * @param embeddings - One vector per chunk, aligned by index.
   */
  add(chunks: readonly PositionAwareChunk[], embeddings: readonly number[][]): Promise<void>;

  /**
   * Find the `k` nearest chunks to the given query embedding.
   * @param queryEmbedding - The query vector (same dimension as stored embeddings).
   * @param k - Maximum number of results to return (default is implementation-specific).
   * @returns Results sorted by descending similarity score.
   */
  search(queryEmbedding: readonly number[], k?: number): Promise<VectorSearchResult[]>;

  /** Remove all stored chunks and embeddings. */
  clear(): Promise<void>;
}
