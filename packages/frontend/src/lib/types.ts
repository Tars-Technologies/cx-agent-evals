export interface DocumentInfo {
  id: string;
  content: string;
  contentLength: number;
}

export interface SpanInfo {
  docId: string;
  start: number;
  end: number;
  text: string;
}

export interface GeneratedQuestion {
  docId: string;
  query: string;
  relevantSpans?: SpanInfo[];
  source?: string;
}

export type StrategyType = "simple" | "dimension-driven" | "real-world-grounded";

export interface Dimension {
  name: string;
  description: string;
  values: string[];
}

export interface GenerateConfig {
  folderPath: string;
  strategy: StrategyType;
  dimensions?: Dimension[];
  totalQuestions?: number;
}

export type SSEEvent =
  | { type: "question"; data: GeneratedQuestion }
  | { type: "done"; totalQuestions: number }
  | { type: "error"; error: string };

export interface UploadMetadata {
  strategy: StrategyType;
  folderPath: string;
  dimensions?: Dimension[];
  totalQuestions?: number;
}

export type UploadSSEEvent =
  | { type: "progress"; uploaded: number; total: number; failed: number }
  | { type: "done"; datasetName: string; datasetUrl: string; uploaded: number; failed: number }
  | { type: "error"; error: string };

export interface PromptPreferences {
  questionTypes: string[];
  tone: string;
  focusAreas: string;
}

export interface UnifiedWizardConfig {
  realWorldQuestions: string[];
  dimensions: Dimension[];
  preferences: PromptPreferences;
  totalQuestions: number;
  allocationOverrides: Record<string, number>;
}
