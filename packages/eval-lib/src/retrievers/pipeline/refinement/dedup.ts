import type { ScoredChunk } from "../types.js"
import { contentOverlapRatio } from "./overlap-ratio.js"

/**
 * Remove duplicate or near-duplicate chunks from scored results.
 *
 * "exact": removes chunks with identical content strings, keeps first occurrence.
 * "overlap": removes chunks from the same document whose character span
 *   overlap ratio >= overlapThreshold, keeps the higher-scored chunk.
 *
 * The overlap method sorts by descending score before deduping so the
 * higher-scored chunk of an overlapping pair always survives, even when the
 * caller passes results in selection order (e.g. after MMR) rather than score
 * order.
 */
export function applyDedup(
  results: readonly ScoredChunk[],
  method: "exact" | "overlap",
  overlapThreshold: number
): ScoredChunk[] {
  if (method === "exact") {
    const seen = new Set<string>()
    return results.filter(({ chunk }) => {
      if (seen.has(chunk.content)) return false
      seen.add(chunk.content)
      return true
    })
  }

  // overlap method: process highest-scored first so the survivor of an
  // overlapping pair is the higher-scored chunk regardless of input order.
  const sorted = [...results].sort((a, b) => b.score - a.score)
  const kept: ScoredChunk[] = []
  for (const result of sorted) {
    const isDuplicate = kept.some(
      (existing) =>
        contentOverlapRatio(existing.chunk, result.chunk) >= overlapThreshold
    )
    if (!isDuplicate) kept.push(result)
  }
  return kept
}
