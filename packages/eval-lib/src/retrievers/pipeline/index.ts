export { PipelineRetriever } from "./pipeline-retriever.js";
export type { PipelineRetrieverDeps } from "./pipeline-retriever.js";
export {
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_QUERY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
} from "./config.js";
export type {
  PipelineConfig,
  IndexConfig,
  QueryConfig,
  IdentityQueryConfig,
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
  SearchConfig,
  DenseSearchConfig,
  BM25SearchConfig,
  HybridSearchConfig,
  RefinementStepConfig,
  RerankRefinementStep,
  ThresholdRefinementStep,
} from "./config.js";
export { BM25SearchIndex, BM25SearchStrategy } from "./search/index.js";
export { DenseSearchStrategy, assignRankScores } from "./search/index.js";
export { HybridSearchStrategy } from "./search/index.js";
export type { SearchStrategy, SearchStrategyDeps } from "./search/index.js";
export type { ScoredChunk } from "./types.js";
export {
  weightedScoreFusion,
  reciprocalRankFusion,
  rrfFuseMultiple,
} from "./search/index.js";
export { applyThresholdFilter } from "./refinement/index.js";

// LLM interface
export type { PipelineLLM } from "./llm.interface.js";

// Query stage
export {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_CONTEXT_PROMPT,
} from "./query/index.js";
