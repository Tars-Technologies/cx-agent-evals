/**
 * Job lifecycle status used by generation, indexing, and experiment pipelines.
 */
export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceling"
  | "canceled";

/**
 * Serialized character span (plain object, no branded types).
 * Used for LangSmith evaluate() I/O where branded types can't cross boundaries.
 */
export interface SerializedSpan {
  docId: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Result of evaluating a single query in an experiment.
 */
export interface ExperimentResult {
  query: string;
  retrievedSpans: SerializedSpan[];
  scores: Record<string, number>;
}
