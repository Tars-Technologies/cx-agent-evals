export type { CitationSpan } from "./citation-validator.js"
export { findCitationSpan } from "./citation-validator.js"
export { filterCombinations } from "./filtering.js"
export { UnifiedQuestionGenerator } from "./generator.js"
export type { MatchingResult } from "./matching.js"
export { matchRealWorldQuestions } from "./matching.js"
export {
  buildPrompt,
  determineScenario,
  generateForDocument,
  parseGenerationResponse,
  splitLargeDocument
} from "./per-doc-generation.js"
export { calculateQuotas } from "./quota.js"
export type {
  DocGenerationResult,
  DocQuota,
  GenerationPlan,
  GenerationScenario,
  MatchedRealWorldQuestion,
  PromptPreferences,
  UnifiedGenerationConfig,
  UnifiedGeneratorContext,
  UnifiedQuestion,
  ValidatedQuestion
} from "./types.js"
