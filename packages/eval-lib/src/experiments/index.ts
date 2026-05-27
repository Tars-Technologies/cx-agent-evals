// Re-export from retrievers/ for backward compatibility.
export type {
  CallbackRetrieverConfig,
  Retriever,
  VectorRAGRetrieverConfig
} from "../retrievers/index.js"
export { CallbackRetriever, VectorRAGRetriever } from "../retrievers/index.js"
export type {
  BaselineVectorRagPresetDeps,
  BM25PresetDeps,
  HybridPresetDeps,
  HybridRerankedPresetDeps,
  PipelinePresetDeps,
  PresetName
} from "./presets.js"
// Experiment presets
export {
  BASELINE_VECTOR_RAG_CONFIG,
  BM25_CONFIG,
  createBaselineVectorRagRetriever,
  createBM25Retriever,
  createHybridRerankedRetriever,
  createHybridRetriever,
  createPresetRetriever,
  HYBRID_CONFIG,
  HYBRID_RERANKED_CONFIG
} from "./presets.js"
