export type {
  UnifiedGenerationConfig,
  PromptPreferences,
  DocQuota,
  MatchedRealWorldQuestion,
  GenerationPlan,
  UnifiedQuestion,
  ValidatedQuestion,
  DocGenerationResult,
  GenerationScenario,
  UnifiedGeneratorContext,
} from "./types.js";

export { UnifiedQuestionGenerator } from "./generator.js";
export { calculateQuotas } from "./quota.js";
export { matchRealWorldQuestions } from "./matching.js";
export type { MatchingResult } from "./matching.js";
export { findCitationSpan } from "./citation-validator.js";
export type { CitationSpan } from "./citation-validator.js";
export {
  generateForDocument,
  determineScenario,
  buildPrompt,
  parseGenerationResponse,
  splitLargeDocument,
} from "./per-doc-generation.js";
export { filterCombinations } from "./filtering.js";
