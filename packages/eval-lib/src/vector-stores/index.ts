export type { CallbackVectorStoreConfig } from "./callback.js"
export { CallbackVectorStore } from "./callback.js"
export type { VectorStoreConfig, VectorStoreHooks } from "./factory.js"
export { makeVectorStore } from "./factory.js"
export { InMemoryVectorStore } from "./in-memory.js"
export type { Bm25DocParams, SparseVector } from "./sparse/bm25-encoder.js"
export {
  DEFAULT_BM25_AVGDL,
  DEFAULT_BM25_B,
  DEFAULT_BM25_K1,
  encodeDocument,
  encodeQuery,
  stableHash,
  tokenize
} from "./sparse/bm25-encoder.js"
export type {
  QdrantCollectionTuning,
  QdrantVectorStoreConfig
} from "./qdrant.js"
export { QdrantVectorStore, qdrantPointId } from "./qdrant.js"
export type {
  MediaScope,
  MediaUpsertItem,
  QdrantMediaStoreConfig
} from "./qdrant-media.js"
export {
  mediaCollectionName,
  mediaPointId,
  QdrantMediaStore
} from "./qdrant-media.js"
export type {
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from "./vector-store.interface.js"
