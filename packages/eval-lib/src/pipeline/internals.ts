/**
 * Pipeline internals — config defaults, fusion functions, and search utilities.
 *
 * These are not part of the public root API surface but are available
 * for advanced use-cases via `@tars-inc/eval-lib/pipeline/internals`.
 */

// Config defaults
export {
  applyDedup,
  applyExpandContext,
  applyMmr,
  applyThresholdFilter,
  assignRankScores,
  BM25SearchIndex,
  DEFAULT_HYDE_PROMPT,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_QUERY_CONFIG,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_STEP_BACK_PROMPT,
  reciprocalRankFusion,
  rrfFuseMultiple,
  weightedScoreFusion
} from "../retrievers/pipeline/index.js"

// Query utilities
export { parseVariants } from "../retrievers/pipeline/query/index.js"
export {
  loadDimensions,
  loadDimensionsFromFile
} from "../synthetic-datagen/strategies/dimension-driven/dimensions.js"

// Dimension discovery utilities
export { discoverDimensions } from "../synthetic-datagen/strategies/dimension-driven/discovery.js"
// InMemoryVectorStore (not used by backend, but kept accessible)
export { InMemoryVectorStore } from "../vector-stores/index.js"
