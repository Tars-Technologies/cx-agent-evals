// Re-export from retrievers/ for backward compatibility.
export type { Retriever } from "../retrievers/index.js";
export { VectorRAGRetriever } from "../retrievers/index.js";
export type { VectorRAGRetrieverConfig } from "../retrievers/index.js";
export { CallbackRetriever } from "../retrievers/index.js";
export type { CallbackRetrieverConfig } from "../retrievers/index.js";

// Experiment presets
export {
  createPresetRetriever,
  createBaselineVectorRagRetriever,
  BASELINE_VECTOR_RAG_CONFIG,
  createBM25Retriever,
  BM25_CONFIG,
  createHybridRetriever,
  HYBRID_CONFIG,
  createHybridRerankedRetriever,
  HYBRID_RERANKED_CONFIG,
} from "./presets.js";
export type {
  PresetName,
  PipelinePresetDeps,
  BaselineVectorRagPresetDeps,
  BM25PresetDeps,
  HybridPresetDeps,
  HybridRerankedPresetDeps,
} from "./presets.js";
