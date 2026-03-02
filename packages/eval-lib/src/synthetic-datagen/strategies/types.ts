import type { Corpus } from "../../types/index.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { LLMClient } from "../base.js";

export interface GeneratedQuery {
  readonly query: string;
  readonly targetDocId: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StrategyContext {
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly embedder?: Embedder;
}

export interface QuestionStrategy {
  readonly name: string;
  generate(context: StrategyContext): Promise<GeneratedQuery[]>;
}

export interface SimpleStrategyOptions {
  readonly queriesPerDoc: number;
  /** Maximum characters of document content sent to the LLM. Default: 8000. */
  readonly maxDocumentChars?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export type ProgressEvent =
  | { phase: "filtering"; totalPairs: number }
  | { phase: "summarizing"; totalDocs: number }
  | { phase: "assigning"; totalCombos: number }
  | { phase: "sampling"; totalQuestions: number }
  | { phase: "generating"; docId: string; docIndex: number; totalDocs: number; questionsForDoc: number }
  | { phase: "ground-truth"; docId: string; docIndex: number; totalDocs: number }
  | { phase: "embedding-questions"; totalQuestions: number }
  | { phase: "embedding-passages"; totalPassages: number }
  | { phase: "matching"; totalQuestions: number }
  | { phase: "done"; totalQuestions: number };

export interface DimensionDrivenStrategyOptions {
  /** Path to dimensions JSON file (for Node.js environments). */
  readonly dimensionsFilePath?: string;
  /** Pre-parsed dimensions (for non-Node environments like Convex). */
  readonly dimensions?: readonly Dimension[];
  readonly totalQuestions: number;
  readonly onProgress?: ProgressCallback;
  /** Maximum characters of document content sent to the LLM. Default: 6000. */
  readonly maxDocumentChars?: number;
}

export interface Dimension {
  readonly name: string;
  readonly description: string;
  readonly values: readonly string[];
}

export type DimensionCombo = Readonly<Record<string, string>>;

export interface DocComboAssignment {
  readonly docId: string;
  readonly combo: DimensionCombo;
}

export interface RelevanceMatrix {
  readonly assignments: readonly DocComboAssignment[];
  readonly docSummaries: ReadonlyMap<string, string>;
}

export interface RealWorldGroundedStrategyOptions {
  readonly questions: readonly string[];
  readonly totalSyntheticQuestions: number;
  readonly matchThreshold?: number;
  readonly fewShotExamplesPerDoc?: number;
  readonly onProgress?: ProgressCallback;
  /** Maximum characters of document content sent to the LLM. Default: 6000. */
  readonly maxDocumentChars?: number;
}

export interface MatchedQuestion {
  readonly question: string;
  readonly score: number;
  readonly passageText: string;
}
