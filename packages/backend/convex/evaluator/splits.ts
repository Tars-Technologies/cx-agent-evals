/**
 * Deterministic data splitting for evaluator train/dev/test sets.
 * Pure functions — no "use node", importable from queries and actions.
 */

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces numbers in [0, 1).
 */
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using a seeded RNG for reproducibility.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const rng = seededRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface SplitConfig {
  trainPct: number;
  devPct: number;
  testPct: number;
}

export interface SplitResult {
  train: string[];
  dev: string[];
  test: string[];
}

/**
 * Deterministically split question IDs into train/dev/test sets.
 *
 * - Sorts IDs alphabetically for deterministic input order
 * - Applies seeded Fisher-Yates shuffle
 * - Splits by percentage (train first, then dev, rest is test)
 */
export function computeSplit(
  questionIds: string[],
  splitConfig: SplitConfig,
  seed: number,
): SplitResult {
  if (questionIds.length === 0) {
    return { train: [], dev: [], test: [] };
  }

  // Sort for deterministic input order
  const sorted = [...questionIds].sort();

  // Shuffle with seed
  const shuffled = seededShuffle(sorted, seed);

  // Compute split boundaries
  const total = shuffled.length;
  const trainCount = Math.max(1, Math.round((splitConfig.trainPct / 100) * total));
  const devCount = Math.max(1, Math.round((splitConfig.devPct / 100) * total));

  const train = shuffled.slice(0, trainCount);
  const dev = shuffled.slice(trainCount, trainCount + devCount);
  const test = shuffled.slice(trainCount + devCount);

  return { train, dev, test };
}
