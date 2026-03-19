import type { ScoredChunk } from "../types.js";
import { contentOverlapRatio } from "./overlap-ratio.js";

/**
 * Maximal Marginal Relevance: iteratively selects results that balance
 * relevance (from search scores) and diversity (from content overlap).
 *
 * mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity
 *
 * Uses character span overlap ratio as the diversity proxy (not embeddings).
 * Cross-document chunks always have overlap = 0 (treated as fully diverse).
 *
 * @param results  Scored chunks from search stage (assumed descending score).
 * @param k        Maximum number of results to select.
 * @param lambda   Trade-off: 1.0 = pure relevance, 0.0 = pure diversity.
 */
export function applyMmr(
  results: readonly ScoredChunk[],
  k: number,
  lambda: number,
): ScoredChunk[] {
  if (results.length === 0) return [];

  const candidates = [...results];
  const selected: ScoredChunk[] = [];

  while (selected.length < k && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const relevance = c.score;

      let maxSimilarity = 0;
      for (const s of selected) {
        const sim = contentOverlapRatio(s.chunk, c.chunk);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(candidates.splice(bestIdx, 1)[0]!);
  }

  return selected;
}
