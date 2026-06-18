import type { Corpus } from "../types/documents.js"
import type { PositionAwareChunk } from "../types/index.js"
import type { VectorFilter } from "../vector-stores/vector-store.interface.js"

/**
 * Read access to the indexed chunk corpus, independent of the vector store.
 * Used by the StatelessQueryRetriever for BM25/hybrid search (full chunk list)
 * and expand-context (full documents). Implementations should treat both
 * methods as expensive and may be called at most once per retriever instance.
 */
export interface ChunkSource {
  /** All chunks matching the filter, deduplicated by chunk id. */
  listChunks(filter: VectorFilter): Promise<readonly PositionAwareChunk[]>
  /** Full documents for the filter's knowledge base (for expand-context). */
  getCorpus(filter: VectorFilter): Promise<Corpus>
}
