import type { ScoredChunk } from "../types.js";
import { contentOverlapRatio } from "./overlap-ratio.js";

/**
 * Remove duplicate or near-duplicate chunks from scored results.
 *
 * "exact": removes chunks with identical content strings, keeps first occurrence.
 * "overlap": removes chunks from the same document whose character span
 *   overlap ratio >= overlapThreshold, keeps the higher-scored chunk.
 *
 * Input is assumed sorted by descending score (first = highest).
 */
export function applyDedup(
  results: readonly ScoredChunk[],
  method: "exact" | "overlap",
  overlapThreshold: number,
): ScoredChunk[] {
  if (method === "exact") {
    const seen = new Set<string>();
    return results.filter(({ chunk }) => {
      if (seen.has(chunk.content)) return false;
      seen.add(chunk.content);
      return true;
    });
  }

  // overlap method: compare against already-kept results
  const kept: ScoredChunk[] = [];
  for (const result of results) {
    const isDuplicate = kept.some(
      (existing) =>
        contentOverlapRatio(existing.chunk, result.chunk) >= overlapThreshold,
    );
    if (!isDuplicate) kept.push(result);
  }
  return kept;
}
