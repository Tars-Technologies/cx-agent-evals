import type { CharacterSpan } from "../types/chunks.js";
import type { Metric } from "./metrics/base.js";
import { mergeOverlappingSpans } from "./metrics/utils.js";

export interface ComputeMetricsOptions {
  readonly results: ReadonlyArray<{
    readonly retrieved: readonly CharacterSpan[];
    readonly groundTruth: readonly CharacterSpan[];
  }>;
  readonly metrics: readonly Metric[];
}

/**
 * Pure function to compute retrieval metrics.
 * Computes each metric for each result and returns averaged scores.
 *
 * Pre-merges overlapping spans once per result and passes them to metrics
 * that support `calculatePreMerged`, avoiding redundant sort+merge operations.
 */
export function computeMetrics(options: ComputeMetricsOptions): Record<string, number> {
  const { results, metrics } = options;

  if (results.length === 0) {
    const scores: Record<string, number> = {};
    for (const metric of metrics) {
      scores[metric.name] = 0;
    }
    return scores;
  }

  const allScores: Record<string, number[]> = {};
  for (const metric of metrics) {
    allScores[metric.name] = [];
  }

  for (const result of results) {
    // Pre-compute merged spans once per result to avoid redundant merging
    // across multiple metrics (each metric would otherwise merge independently).
    const mergedRetrieved = mergeOverlappingSpans(result.retrieved);
    const mergedGroundTruth = mergeOverlappingSpans(result.groundTruth);

    for (const metric of metrics) {
      const score = metric.calculatePreMerged
        ? metric.calculatePreMerged(mergedRetrieved, mergedGroundTruth)
        : metric.calculate(result.retrieved, result.groundTruth);
      allScores[metric.name].push(score);
    }
  }

  const avgScores: Record<string, number> = {};
  for (const [name, scores] of Object.entries(allScores)) {
    avgScores[name] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  return avgScores;
}
