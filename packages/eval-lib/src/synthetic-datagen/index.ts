import type { Corpus, GroundTruth } from "../types/index.js"
import type { LLMClient } from "./base.js"
import { GroundTruthAssigner } from "./ground-truth/token-level.js"
import type { QuestionStrategy } from "./strategies/types.js"

// Re-export everything consumers need
export type { LLMClient } from "./base.js"
export { openAIClientAdapter } from "./base.js"
export { GroundTruthAssigner } from "./ground-truth/token-level.js"
export type {
  Assigner,
  GroundTruthAssignerContext,
  GroundTruthAssignerInterface
} from "./ground-truth/types.js"
export {
  loadDimensions,
  loadDimensionsFromFile,
  parseDimensions
} from "./strategies/dimension-driven/dimensions.js"
export { discoverDimensions } from "./strategies/dimension-driven/discovery.js"
export { DimensionDrivenStrategy } from "./strategies/dimension-driven/generator.js"
export { RealWorldGroundedStrategy } from "./strategies/real-world-grounded/generator.js"
export { SimpleStrategy } from "./strategies/simple/generator.js"
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
} from "./strategies/types.js"
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
} from "./unified/index.js"
// Unified pipeline
export { UnifiedQuestionGenerator } from "./unified/index.js"

export interface GenerateOptions {
  readonly strategy: QuestionStrategy
  readonly corpus: Corpus
  readonly llmClient: LLMClient
  readonly model?: string
}

export async function generate(
  options: GenerateOptions
): Promise<GroundTruth[]> {
  const model = options.model ?? "gpt-4o"
  const context = {
    corpus: options.corpus,
    llmClient: options.llmClient,
    model
  }

  const queries = await options.strategy.generate(context)

  const assigner = new GroundTruthAssigner()
  const results = await assigner.assign(queries, context)

  return results
}
