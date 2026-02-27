import type { PositionAwareChunk } from "../../../types/index.js";
import type { ScoredChunk } from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Use String() to convert the branded id into a plain Map key. */
function chunkKey(chunk: PositionAwareChunk): string {
  return String(chunk.id);
}

interface FusionEntry {
  readonly chunk: PositionAwareChunk;
  denseScore: number;
  sparseScore: number;
}

function buildEntryMap(
  denseResults: readonly ScoredChunk[],
  sparseResults: readonly ScoredChunk[],
): Map<string, FusionEntry> {
  const entries = new Map<string, FusionEntry>();

  for (const { chunk, score } of denseResults) {
    const key = chunkKey(chunk);
    entries.set(key, { chunk, denseScore: score, sparseScore: 0 });
  }

  for (const { chunk, score } of sparseResults) {
    const key = chunkKey(chunk);
    const existing = entries.get(key);
    if (existing) {
      existing.sparseScore = score;
    } else {
      entries.set(key, { chunk, denseScore: 0, sparseScore: score });
    }
  }

  return entries;
}

function sortDescending(results: ScoredChunk[]): ScoredChunk[] {
  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Weighted Score Fusion
// ---------------------------------------------------------------------------

export interface WeightedScoreFusionParams {
  readonly denseResults: readonly ScoredChunk[];
  readonly sparseResults: readonly ScoredChunk[];
  readonly denseWeight: number;
  readonly sparseWeight: number;
}

/**
 * Combines dense and sparse retrieval scores using a linear weighting.
 *
 * For each unique chunk, the fused score is:
 *   `denseWeight * denseScore + sparseWeight * sparseScore`
 *
 * Chunks appearing in only one list receive 0 for the missing score.
 * Returns results sorted by fused score descending.
 */
export function weightedScoreFusion(
  params: WeightedScoreFusionParams,
): ScoredChunk[] {
  const { denseResults, sparseResults, denseWeight, sparseWeight } = params;
  const entries = buildEntryMap(denseResults, sparseResults);

  const fused: ScoredChunk[] = [];
  for (const entry of entries.values()) {
    fused.push({
      chunk: entry.chunk,
      score: denseWeight * entry.denseScore + sparseWeight * entry.sparseScore,
    });
  }

  return sortDescending(fused);
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

export interface ReciprocalRankFusionParams {
  readonly denseResults: readonly ScoredChunk[];
  readonly sparseResults: readonly ScoredChunk[];
  /** Smoothing constant (default 60). */
  readonly k?: number;
}

/**
 * Combines dense and sparse retrieval results using Reciprocal Rank Fusion.
 *
 * For each unique chunk, the RRF score is:
 *   `sum(1 / (k + rank))` across every list in which the chunk appears.
 *
 * Ranks are 1-based (the first item in a list has rank 1).
 * Returns results sorted by RRF score descending.
 */
export function reciprocalRankFusion(
  params: ReciprocalRankFusionParams,
): ScoredChunk[] {
  const { denseResults, sparseResults, k = 60 } = params;

  const scores = new Map<string, { chunk: PositionAwareChunk; score: number }>();

  const accumulateRanks = (results: readonly ScoredChunk[]): void => {
    for (let i = 0; i < results.length; i++) {
      const { chunk } = results[i];
      const key = chunkKey(chunk);
      const rank = i + 1; // 1-based
      const rrfContribution = 1 / (k + rank);

      const existing = scores.get(key);
      if (existing) {
        existing.score += rrfContribution;
      } else {
        scores.set(key, { chunk, score: rrfContribution });
      }
    }
  };

  accumulateRanks(denseResults);
  accumulateRanks(sparseResults);

  const fused: ScoredChunk[] = [];
  for (const { chunk, score } of scores.values()) {
    fused.push({ chunk, score });
  }

  return sortDescending(fused);
}
