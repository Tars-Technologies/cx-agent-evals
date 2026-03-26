/**
 * Pipeline internals — config defaults, fusion functions, and search utilities.
 *
 * These are not part of the public root API surface but are available
 * for advanced use-cases via `rag-evaluation-system/pipeline/internals`.
 */

// Config defaults
export {
  DEFAULT_INDEX_CONFIG,
  DEFAULT_QUERY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  BM25SearchIndex,
  weightedScoreFusion,
  reciprocalRankFusion,
  rrfFuseMultiple,
  assignRankScores,
  applyThresholdFilter,
  applyDedup,
  applyMmr,
  applyExpandContext,
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
} from "../retrievers/pipeline/index.js";

// Query utilities
export { parseVariants } from "../retrievers/pipeline/query/index.js";

// InMemoryVectorStore (not used by backend, but kept accessible)
export { InMemoryVectorStore } from "../vector-stores/index.js";

// Dimension discovery utilities
export { discoverDimensions } from "../synthetic-datagen/strategies/dimension-driven/discovery.js";
export {
  loadDimensions,
  loadDimensionsFromFile,
} from "../synthetic-datagen/strategies/dimension-driven/dimensions.js";
