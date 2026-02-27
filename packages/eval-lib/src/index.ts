// Types and type factories (DocumentId etc. are both type and value)
export {
  DocumentId,
  QueryId,
  QueryText,
  PositionAwareChunkId,
} from "./types/index.js";
export type {
  Brand,
  Document,
  Corpus,
  CharacterSpan,
  SpanRange,
  PositionAwareChunk,
  Query,
  GroundTruth,
  DatasetExample,
  EvaluationResult,
  RunOutput,
} from "./types/index.js";

// Type utilities
export {
  DocumentSchema,
  CorpusSchema,
  createDocument,
  createCorpus,
  createCorpusFromDocuments,
  getDocument,
  CharacterSpanSchema,
  createCharacterSpan,
  positionAwareChunkToSpan,
  DatasetExampleSchema,
} from "./types/index.js";

// Chunkers
export type { Chunker, PositionAwareChunker, RecursiveCharacterChunkerOptions } from "./chunkers/index.js";
export { isPositionAwareChunker, RecursiveCharacterChunker } from "./chunkers/index.js";

// Embedder
export type { Embedder } from "./embedders/index.js";
export { OpenAIEmbedder } from "./embedders/index.js";

// Vector Store
export type { VectorStore } from "./vector-stores/index.js";
export { InMemoryVectorStore } from "./vector-stores/index.js";

// Reranker
export type { Reranker } from "./rerankers/index.js";

// Evaluation
export type { Metric } from "./evaluation/index.js";
export { computeMetrics } from "./evaluation/index.js";
export type { ComputeMetricsOptions } from "./evaluation/index.js";

// Metrics
export { recall, precision, iou, f1 } from "./evaluation/metrics/index.js";
export { mergeOverlappingSpans, calculateOverlap, totalSpanLength } from "./evaluation/metrics/utils.js";

// Retrievers (canonical location: src/retrievers/)
/** @deprecated Use `createBaselineVectorRagRetriever()` from `experiments/presets` instead */
export { VectorRAGRetriever } from "./retrievers/index.js";
export { CallbackRetriever } from "./retrievers/index.js";
export type {
  Retriever,
  VectorRAGRetrieverConfig,
  CallbackRetrieverConfig,
} from "./retrievers/index.js";

// Pipeline Retriever
export {
  PipelineRetriever,
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_QUERY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  BM25SearchIndex,
  weightedScoreFusion,
  reciprocalRankFusion,
  applyThresholdFilter,
} from "./retrievers/index.js";
export type {
  PipelineRetrieverDeps,
  PipelineConfig,
  IndexConfig,
  QueryConfig,
  SearchConfig,
  DenseSearchConfig,
  BM25SearchConfig,
  HybridSearchConfig,
  RefinementStepConfig,
  ScoredChunk,
} from "./retrievers/index.js";

// Experiment Presets
export {
  createBaselineVectorRagRetriever,
  BASELINE_VECTOR_RAG_CONFIG,
  createBM25Retriever,
  BM25_CONFIG,
  createHybridRetriever,
  HYBRID_CONFIG,
  createHybridRerankedRetriever,
  HYBRID_RERANKED_CONFIG,
} from "./experiments/index.js";
export type {
  BaselineVectorRagPresetDeps,
  BM25PresetDeps,
  HybridPresetDeps,
  HybridRerankedPresetDeps,
} from "./experiments/index.js";

// Synthetic Data Generation
export type { LLMClient } from "./synthetic-datagen/base.js";
export { openAIClientAdapter } from "./synthetic-datagen/base.js";
export { generate } from "./synthetic-datagen/index.js";
export type { GenerateOptions } from "./synthetic-datagen/index.js";
export { SimpleStrategy } from "./synthetic-datagen/strategies/simple/generator.js";
export { DimensionDrivenStrategy } from "./synthetic-datagen/strategies/dimension-driven/generator.js";
export { RealWorldGroundedStrategy } from "./synthetic-datagen/strategies/real-world-grounded/generator.js";
export { discoverDimensions } from "./synthetic-datagen/strategies/dimension-driven/discovery.js";
export {
  loadDimensions,
  loadDimensionsFromFile,
  parseDimensions,
} from "./synthetic-datagen/strategies/dimension-driven/dimensions.js";
export { GroundTruthAssigner } from "./synthetic-datagen/ground-truth/token-level.js";
export type {
  Assigner,
  GroundTruthAssignerInterface,
  GroundTruthAssignerContext,
} from "./synthetic-datagen/ground-truth/types.js";
export type {
  QuestionStrategy,
  GeneratedQuery,
  StrategyContext,
  SimpleStrategyOptions,
  DimensionDrivenStrategyOptions,
  RealWorldGroundedStrategyOptions,
  MatchedQuestion,
  Dimension,
  DimensionCombo,
  ProgressCallback,
  ProgressEvent,
} from "./synthetic-datagen/strategies/types.js";

// LangSmith
export {
  getLangSmithClient,
  uploadDataset,
  loadDataset,
  createLangSmithEvaluator,
  createLangSmithEvaluators,
  listDatasets,
  listExperiments,
  getCompareUrl,
} from "./langsmith/index.js";
export type {
  UploadOptions,
  UploadResult,
  UploadProgress,
  DatasetInfo,
  ExperimentInfo,
} from "./langsmith/index.js";

// LangSmith experiment runner is available via:
//   import { runLangSmithExperiment } from "rag-evaluation-system/langsmith/experiment-runner"
// It is NOT re-exported from the main index to avoid pulling langsmith
// into the module graph for consumers that don't need experiment running.
export type { LangSmithExperimentConfig, ExperimentResult } from "./langsmith/index.js";

// Utils
export { generatePaChunkId } from "./utils/hashing.js";
export { spanOverlaps, spanOverlapChars, spanLength } from "./utils/span.js";
