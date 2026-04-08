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
 * Internal helper: split a single class of IDs into train/dev/test by percentage.
 */
function splitOneClass(
  ids: string[],
  splitConfig: SplitConfig,
  seed: number,
): SplitResult {
  if (ids.length === 0) return { train: [], dev: [], test: [] };

  const sorted = [...ids].sort();
  const shuffled = seededShuffle(sorted, seed);

  const total = shuffled.length;
  // Always reserve at least 1 example for train when we have data,
  // so the rare class is represented in the few-shot pool.
  const trainCount = Math.max(1, Math.round((splitConfig.trainPct / 100) * total));
  // For dev and test, only enforce min if there's room left
  const remainingAfterTrain = total - trainCount;
  let devCount = Math.round((splitConfig.devPct / 100) * total);
  if (remainingAfterTrain > 0 && devCount === 0) devCount = 1;
  devCount = Math.min(devCount, remainingAfterTrain);

  const train = shuffled.slice(0, trainCount);
  const dev = shuffled.slice(trainCount, trainCount + devCount);
  const test = shuffled.slice(trainCount + devCount);

  return { train, dev, test };
}

/**
 * Deterministic, label-stratified train/dev/test split.
 *
 * Splits passes and fails independently so each subset has proportional
 * representation of the rare class. Without stratification, when fails are
 * scarce (e.g. 3 of 30 eligible), random splitting often puts 0 fails in
 * the training set, starving the few-shot sampler.
 *
 * Falls back to a single-class split when only one label is provided.
 */
export function computeSplit(
  questionIds: string[],
  splitConfig: SplitConfig,
  seed: number,
  labels?: Map<string, "pass" | "fail">,
): SplitResult {
  if (questionIds.length === 0) {
    return { train: [], dev: [], test: [] };
  }

  // Backward-compatible path: no labels provided → flat random split
  if (!labels) {
    return splitOneClass(questionIds, splitConfig, seed);
  }

  // Bucket by label
  const passes: string[] = [];
  const fails: string[] = [];
  for (const id of questionIds) {
    if (labels.get(id) === "fail") fails.push(id);
    else passes.push(id);
  }

  // Split each class independently with derived seeds
  const passSplit = splitOneClass(passes, splitConfig, seed);
  const failSplit = splitOneClass(fails, splitConfig, (seed ^ 0x5a5a5a5a) | 0);

  return {
    train: [...passSplit.train, ...failSplit.train],
    dev: [...passSplit.dev, ...failSplit.dev],
    test: [...passSplit.test, ...failSplit.test],
  };
}

export interface StratifiedFewShotResult {
  /** Picked IDs in interleaved order (alternating pass/fail) */
  ids: string[];
  passCount: number;
  failCount: number;
}

/**
 * Stratified few-shot sampling.
 *
 * - Aims for a 50/50 pass/fail split when possible
 * - Caps at `targetCount` total
 * - If one class is short, fills the remaining slots from the other
 * - Deterministic via seed
 * - Returns interleaved order (pass, fail, pass, fail, ...) for prompt diversity
 */
export function stratifiedFewShot(
  passIds: string[],
  failIds: string[],
  targetCount: number,
  seed: number,
): StratifiedFewShotResult {
  if (targetCount === 0 || (passIds.length === 0 && failIds.length === 0)) {
    return { ids: [], passCount: 0, failCount: 0 };
  }

  // Sort for deterministic input ordering, then shuffle with different seeds
  const sortedPasses = [...passIds].sort();
  const sortedFails = [...failIds].sort();
  const shuffledPasses = seededShuffle(sortedPasses, seed);
  // Use a derived seed for the fail set so the two shuffles are independent
  const shuffledFails = seededShuffle(sortedFails, (seed ^ 0x5a5a5a5a) | 0);

  // Try a 50/50 split first
  const half = Math.ceil(targetCount / 2);
  let passCount = Math.min(half, shuffledPasses.length);
  let failCount = Math.min(targetCount - passCount, shuffledFails.length);

  // If we still have headroom (one class was short), fill from the other
  let remaining = targetCount - passCount - failCount;
  if (remaining > 0) {
    if (passCount < shuffledPasses.length) {
      const fill = Math.min(remaining, shuffledPasses.length - passCount);
      passCount += fill;
      remaining -= fill;
    }
    if (remaining > 0 && failCount < shuffledFails.length) {
      failCount += Math.min(remaining, shuffledFails.length - failCount);
    }
  }

  const pickedPasses = shuffledPasses.slice(0, passCount);
  const pickedFails = shuffledFails.slice(0, failCount);

  // Interleave pass/fail for prompt diversity
  const ids: string[] = [];
  let pi = 0;
  let fi = 0;
  while (pi < pickedPasses.length || fi < pickedFails.length) {
    if (pi < pickedPasses.length) ids.push(pickedPasses[pi++]);
    if (fi < pickedFails.length) ids.push(pickedFails[fi++]);
  }

  return { ids, passCount, failCount };
}
