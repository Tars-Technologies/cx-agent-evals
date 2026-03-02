import type { ScoredChunk } from "../types.js";

/**
 * Filters scored chunks that fall below a minimum similarity score.
 *
 * Preserves the original ordering of results that meet the threshold.
 * Returns an empty array when no results meet the threshold or the input is empty.
 */
export function applyThresholdFilter(
  results: readonly ScoredChunk[],
  minScore: number,
): ScoredChunk[] {
  return results.filter((result) => result.score >= minScore);
}
