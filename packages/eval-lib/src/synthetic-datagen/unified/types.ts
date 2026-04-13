import type { Dimension } from "../strategies/types.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { LLMClient } from "../base.js";
import type { Corpus } from "../../types/index.js";

export interface UnifiedGenerationConfig {
  readonly totalQuestions: number;
  readonly model?: string;
  readonly promptPreferences: PromptPreferences;
  readonly realWorldQuestions?: readonly string[];
  readonly dimensions?: readonly Dimension[];
  readonly allocationOverrides?: Record<string, number>;
}

export interface PromptPreferences {
  readonly questionTypes: readonly string[];
  readonly tone: string;
  readonly focusAreas: string;
}

export interface DocQuota {
  readonly docId: string;
  readonly quota: number;
  readonly priority: number;
}

export interface MatchedRealWorldQuestion {
  readonly question: string;
  readonly score: number;
  readonly passageText: string;
}

export interface GenerationPlan {
  readonly quotas: Record<string, number>;
  readonly matchedByDoc: Record<string, MatchedRealWorldQuestion[]>;
  readonly unmatchedQuestions: string[];
  readonly validCombos: ReadonlyArray<Record<string, string>>;
}

export interface UnifiedQuestion {
  readonly question: string;
  readonly citation: string;
  readonly source: "generated" | "real-world";
  readonly profile: string | null;
  readonly docId: string;
}

export interface ValidatedQuestion extends UnifiedQuestion {
  readonly span: {
    readonly docId: string;
    readonly start: number;
    readonly end: number;
    readonly text: string;
  };
}

export interface DocGenerationResult {
  readonly docId: string;
  readonly questions: ValidatedQuestion[];
  readonly failedCitations: number;
}

export type GenerationScenario = 1 | 2 | 3 | 4;

export interface UnifiedGeneratorContext {
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly embedder?: Embedder;
}
