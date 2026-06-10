// Types and type factories (DocumentId etc. are both type and value)

// Chunkers
// Async chunkers
export type {
  AsyncPositionAwareChunker,
  Chunker,
  ClusterSemanticChunkerOptions,
  LLMSemanticChunkerOptions,
  MarkdownChunkerOptions,
  PositionAwareChunker,
  RecursiveCharacterChunkerOptions,
  SemanticChunkerOptions,
  SentenceChunkerOptions,
  TokenChunkerOptions
} from "./chunkers/index.js"
export {
  ClusterSemanticChunker,
  isAsyncPositionAwareChunker,
  isPositionAwareChunker,
  LLMSemanticChunker,
  MarkdownChunker,
  RecursiveCharacterChunker,
  SemanticChunker,
  SentenceChunker,
  TokenChunker
} from "./chunkers/index.js"
// Embedder
export type { Embedder } from "./embedders/index.js"
export { OpenAIEmbedder } from "./embedders/index.js"
export type {
  Brand,
  CharacterSpan,
  Corpus,
  DatasetExample,
  Document,
  EvaluationResult,
  GroundTruth,
  PositionAwareChunk,
  Query,
  RunOutput,
  SpanRange
} from "./types/index.js"
export {
  CharacterSpanSchema,
  CorpusSchema,
  createCharacterSpan,
  createCorpus,
  createCorpusFromDocuments,
  createDocument,
  DatasetExampleSchema,
  DocumentId,
  DocumentSchema,
  getDocument,
  PositionAwareChunkId,
  positionAwareChunkToSpan,
  QueryId,
  QueryText
} from "./types/index.js"
export type {
  CallbackVectorStoreConfig,
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore,
  VectorStoreConfig,
  VectorStoreHooks
} from "./vector-stores/index.js"
// Vector Store
export { CallbackVectorStore, makeVectorStore } from "./vector-stores/index.js"

// InMemoryVectorStore moved to "@tars-inc/eval-lib/pipeline/internals"

// Evaluation
export type { ComputeMetricsOptions, Metric } from "./evaluation/index.js"
export { computeMetrics } from "./evaluation/index.js"
// Metrics
export { f1, iou, precision, recall } from "./evaluation/metrics/index.js"
// Reranker
export type { Reranker } from "./rerankers/index.js"

// mergeOverlappingSpans, calculateOverlap, totalSpanLength moved to "@tars-inc/eval-lib/utils"

export type {
  BaselineVectorRagPresetDeps,
  BM25PresetDeps,
  HybridPresetDeps,
  HybridRerankedPresetDeps,
  PipelinePresetDeps,
  PresetName
} from "./experiments/index.js"
// Experiment Presets
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
} from "./experiments/index.js"
export type {
  BM25SearchConfig,
  CallbackRetrieverConfig,
  ContextualIndexConfig,
  DedupRefinementStep,
  DenseSearchConfig,
  ExpandContextRefinementStep,
  HybridSearchConfig,
  HydeQueryConfig,
  IdentityQueryConfig,
  IndexConfig,
  MmrRefinementStep,
  MultiQueryConfig,
  ParentChildIndexConfig,
  PipelineConfig,
  PipelineLLM,
  PipelineRetrieverDeps,
  PlainIndexConfig,
  QueryConfig,
  RefinementStepConfig,
  RerankRefinementStep,
  Retriever,
  RewriteQueryConfig,
  ScoredChunk,
  SearchConfig,
  StepBackQueryConfig,
  SummaryIndexConfig,
  ThresholdRefinementStep,
  VectorRAGRetrieverConfig
} from "./retrievers/index.js"
// Retrievers (canonical location: src/retrievers/)
/** @deprecated Use `createBaselineVectorRagRetriever()` from `experiments/presets` instead */
// Pipeline Retriever
export {
  CallbackRetriever,
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  PipelineRetriever,
  VectorRAGRetriever
} from "./retrievers/index.js"

// Synthetic Data Generation
export type { LLMClient } from "./synthetic-datagen/base.js"
export { openAIClientAdapter } from "./synthetic-datagen/base.js"
export { GroundTruthAssigner } from "./synthetic-datagen/ground-truth/token-level.js"
export type {
  Assigner,
  GroundTruthAssignerContext,
  GroundTruthAssignerInterface
} from "./synthetic-datagen/ground-truth/types.js"
export type { GenerateOptions } from "./synthetic-datagen/index.js"
export { generate } from "./synthetic-datagen/index.js"
// discoverDimensions moved to "@tars-inc/eval-lib/pipeline/internals"
// loadDimensions, loadDimensionsFromFile moved to "@tars-inc/eval-lib/pipeline/internals"
export { parseDimensions } from "./synthetic-datagen/strategies/dimension-driven/dimensions.js"
export { DimensionDrivenStrategy } from "./synthetic-datagen/strategies/dimension-driven/generator.js"
export { RealWorldGroundedStrategy } from "./synthetic-datagen/strategies/real-world-grounded/generator.js"
export { SimpleStrategy } from "./synthetic-datagen/strategies/simple/generator.js"
export type {
  Dimension,
  DimensionCombo,
  DimensionDrivenStrategyOptions,
  GeneratedQuery,
  MatchedQuestion,
  ProgressCallback,
  ProgressEvent,
  QuestionStrategy,
  RealWorldGroundedStrategyOptions,
  SimpleStrategyOptions,
  StrategyContext
} from "./synthetic-datagen/strategies/types.js"
export type {
  CitationSpan,
  DocGenerationResult,
  DocQuota,
  GenerationPlan,
  GenerationScenario,
  MatchedRealWorldQuestion,
  MatchingResult,
  PromptPreferences,
  UnifiedGenerationConfig,
  UnifiedGeneratorContext,
  UnifiedQuestion,
  ValidatedQuestion
} from "./synthetic-datagen/unified/index.js"
// Unified question generation pipeline
export {
  calculateQuotas,
  filterCombinations,
  findCitationSpan,
  generateForDocument,
  matchRealWorldQuestions,
  UnifiedQuestionGenerator
} from "./synthetic-datagen/unified/index.js"

// Utils
export { generatePaChunkId } from "./utils/hashing.js"
export { spanLength, spanOverlapChars, spanOverlaps } from "./utils/span.js"
