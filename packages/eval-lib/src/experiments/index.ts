// Re-export from retrievers/ for backward compatibility.
// The canonical location for retriever code is now src/retrievers/.
export type { Retriever } from "../retrievers/index.js";
export { VectorRAGRetriever } from "../retrievers/index.js";
export type { VectorRAGRetrieverConfig } from "../retrievers/index.js";
export { CallbackRetriever } from "../retrievers/index.js";
export type { CallbackRetrieverConfig } from "../retrievers/index.js";

// ---------------------------------------------------------------------------
// Experiment presets — factory functions for pre-configured PipelineRetriever
// ---------------------------------------------------------------------------

export {
  createBaselineVectorRagRetriever,
  BASELINE_VECTOR_RAG_CONFIG,
} from "./baseline-vector-rag/index.js";
export type { BaselineVectorRagPresetDeps } from "./baseline-vector-rag/index.js";

export { createBM25Retriever, BM25_CONFIG } from "./bm25/index.js";
export type { BM25PresetDeps } from "./bm25/index.js";

export { createHybridRetriever, HYBRID_CONFIG } from "./hybrid/index.js";
export type { HybridPresetDeps } from "./hybrid/index.js";

export {
  createHybridRerankedRetriever,
  HYBRID_RERANKED_CONFIG,
} from "./hybrid-reranked/index.js";
export type { HybridRerankedPresetDeps } from "./hybrid-reranked/index.js";
