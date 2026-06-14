import type { PositionAwareChunk } from "../types/index.js"

/** A chunk paired with its cosine-similarity score from vector search. */
export interface VectorSearchResult {
  readonly chunk: PositionAwareChunk
  /** Similarity score in [0, 1] where higher means more similar. */
  readonly score: number
}

/**
 * Scope/filter for vector-store operations. All defined fields must match.
 * Stores that hold a single scope (e.g. one Qdrant collection per
 * kb+indexConfigHash) may ignore fields that are implied by their scope.
 */
export interface VectorFilter {
  readonly kbId?: string
  readonly indexConfigHash?: string
  readonly documentId?: string
}

export interface VectorSearchOptions {
  readonly k: number
  readonly filter?: VectorFilter
}

/**
 * Stores position-aware chunk embeddings and supports approximate
 * nearest-neighbor search. Chunks retain their character offsets so search
 * results can be evaluated directly against ground-truth spans.
 */
export interface VectorStore {
  /** Human-readable identifier (e.g. "in-memory", "convex-native", "qdrant"). */
  readonly name: string

  /**
   * Insert chunks and their corresponding embedding vectors.
   * @param chunks - Chunks to index; must be the same length as `embeddings`.
   * @param embeddings - One vector per chunk, aligned by index.
   * @param scope - Optional scope stamped on the stored entries so later
   *   `search`/delete calls can filter by it.
   */
  add(
    chunks: readonly PositionAwareChunk[],
    embeddings: readonly number[][],
    scope?: VectorFilter
  ): Promise<void>

  /**
   * Find the `opts.k` nearest chunks to the query embedding, restricted to
   * entries matching `opts.filter` when provided.
   * @returns Results sorted by descending similarity score.
   */
  search(
    queryEmbedding: readonly number[],
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]>

  /** Remove all entries for one source document. Optional capability. */
  deleteByDocument?(documentId: string, filter?: VectorFilter): Promise<void>

  /** Remove all entries for one knowledge base. Optional capability. */
  deleteByKnowledgeBase?(kbId: string, filter?: VectorFilter): Promise<void>

  /**
   * Remove stored entries matching `filter` (all entries if omitted). A store
   * shared across tenants (e.g. Qdrant keyed on a payload partition) may reject
   * an unscoped clear rather than wipe every tenant; pass a scope filter there.
   */
  clear(filter?: VectorFilter): Promise<void>

  /** True when the store is reachable and compatible. Optional capability. */
  checkHealth?(): Promise<boolean>
}
