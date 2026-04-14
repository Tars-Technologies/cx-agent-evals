import type { Corpus, GroundTruth } from "../types/index.js";
import type { LLMClient } from "./base.js";
import type { QuestionStrategy } from "./strategies/types.js";
import { GroundTruthAssigner } from "./ground-truth/token-level.js";

// Re-export everything consumers need
export type { LLMClient } from "./base.js";
export { openAIClientAdapter } from "./base.js";
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
} from "./strategies/types.js";
export { SimpleStrategy } from "./strategies/simple/generator.js";
export { DimensionDrivenStrategy } from "./strategies/dimension-driven/generator.js";
export { RealWorldGroundedStrategy } from "./strategies/real-world-grounded/generator.js";
export { discoverDimensions } from "./strategies/dimension-driven/discovery.js";
export {
  loadDimensions,
  loadDimensionsFromFile,
  parseDimensions,
} from "./strategies/dimension-driven/dimensions.js";
export { GroundTruthAssigner } from "./ground-truth/token-level.js";
export type { Assigner, GroundTruthAssignerInterface, GroundTruthAssignerContext } from "./ground-truth/types.js";

// Unified pipeline
export { UnifiedQuestionGenerator } from "./unified/index.js";
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
} from "./unified/index.js";

export interface GenerateOptions {
  readonly strategy: QuestionStrategy;
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model?: string;
}

export async function generate(options: GenerateOptions): Promise<GroundTruth[]> {
  const model = options.model ?? "gpt-4o";
  const context = {
    corpus: options.corpus,
    llmClient: options.llmClient,
    model,
  };

  const queries = await options.strategy.generate(context);

  const assigner = new GroundTruthAssigner();
  const results = await assigner.assign(queries, context);

  return results;
}
