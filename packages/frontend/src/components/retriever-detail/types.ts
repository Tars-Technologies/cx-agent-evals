import type { Id } from "@convex/_generated/dataModel";

export type SpanLite = {
  docId: string;
  start: number;
  end: number;
  text: string;
};

export type QuestionStatus = "hit" | "partial" | "miss";

export type DetailQuestionRow = {
  resultId: Id<"experimentResults">;
  questionId: Id<"questions">;
  queryText: string;
  sourceDocId: string;
  goldSpans: SpanLite[];
  retrievedSpans: SpanLite[];
  scores: Record<string, number>;
  status: QuestionStatus;
};

export const STATUS_COLORS: Record<QuestionStatus, { dot: string; bg: string; label: string }> = {
  hit: { dot: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "Hit" },
  partial: { dot: "#eab308", bg: "rgba(234,179,8,0.12)", label: "Partial" },
  miss: { dot: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Miss" },
};
