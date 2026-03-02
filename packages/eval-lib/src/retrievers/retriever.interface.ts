import type { Corpus, PositionAwareChunk } from "../types/index.js";

/**
 * End-to-end retrieval pipeline that accepts a query and returns position-aware chunks.
 * Implementations handle their own indexing (chunking, embedding, storage) during {@link init}
 * and return ranked results with character offsets suitable for span-based evaluation.
 */
export interface Retriever {
  /** Human-readable identifier used in experiment results and LangSmith metadata. */
  readonly name: string;

  /**
   * Index the corpus so subsequent {@link retrieve} calls can search it.
   * Typically chunks documents, generates embeddings, and populates a vector store.
   */
  init(corpus: Corpus): Promise<void>;

  /**
   * Return the top-k chunks most relevant to the query, ordered by relevance.
   * Each chunk carries character offsets (`start`/`end`) for span-based metric computation.
   */
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;

  /** Release resources (e.g., external vector store connections) acquired during {@link init}. */
  cleanup(): Promise<void>;
}
