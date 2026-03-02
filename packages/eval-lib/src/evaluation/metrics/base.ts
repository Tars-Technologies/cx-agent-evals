import type { CharacterSpan, SpanRange } from "../../types/chunks.js";

/**
 * A single evaluation metric that scores retrieval quality by comparing
 * retrieved character spans against ground-truth spans.
 * Built-in implementations include recall, precision, IoU, and F1.
 */
export interface Metric {
  /** Metric identifier used as the key in result score maps (e.g., "recall", "f1"). */
  readonly name: string;

  /**
   * Compute the metric from raw retrieved and ground-truth spans.
   * Spans may overlap or be unmerged -- the implementation handles normalization.
   * @returns A score in [0, 1] where 1 is a perfect match.
   */
  readonly calculate: (
    retrieved: readonly CharacterSpan[],
    groundTruth: readonly CharacterSpan[],
  ) => number;

  /**
   * Optional optimized variant that accepts pre-merged, non-overlapping spans.
   * When provided, {@link computeMetrics} calls this instead of {@link calculate}
   * to avoid redundant merge operations across multiple metrics.
   */
  readonly calculatePreMerged?: (
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ) => number;
}
