/**
 * Converts text into fixed-dimension vector embeddings for similarity search.
 * Separate methods for batch document embedding and single-query embedding
 * allow implementations to optimize throughput vs. latency independently.
 */
export interface Embedder {
  /** Human-readable identifier (e.g., "openai-text-embedding-3-small"). */
  readonly name: string;

  /** Dimensionality of the output vectors; must match the vector store index. */
  readonly dimension: number;

  /**
   * Embed multiple texts in a single batch call.
   * Used during indexing to embed all chunks at once.
   * @returns One embedding vector per input text, in the same order.
   */
  embed(texts: readonly string[]): Promise<number[][]>;

  /**
   * Embed a single query string for vector search.
   * Kept separate from {@link embed} because some providers use a different
   * encoding for queries vs. documents (e.g., instruction-prefixed models).
   */
  embedQuery(query: string): Promise<number[]>;
}
