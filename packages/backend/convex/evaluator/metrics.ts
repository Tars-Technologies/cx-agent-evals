/**
 * Statistical metrics for LLM-as-Judge evaluation.
 * Pure functions — no "use node", importable from queries and actions.
 *
 * Terminology (from the book "Application-Centric AI Evals"):
 * - TPR (True Positive Rate): fraction of actual Passes the judge correctly calls Pass
 * - TNR (True Negative Rate): fraction of actual Fails the judge correctly calls Fail
 * - Rogan-Gladen correction: adjusts raw pass rate for judge imperfection
 * - Bootstrap CI: 95% confidence interval via resampling
 */

export interface JudgmentPair {
  humanLabel: "pass" | "fail";
  judgeVerdict: "pass" | "fail";
}

export interface TPRTNRResult {
  tpr: number;
  tnr: number;
  accuracy: number;
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
}

/**
 * Compute TPR, TNR, and accuracy from human labels vs judge verdicts.
 */
export function computeTPRTNR(results: JudgmentPair[]): TPRTNRResult {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const r of results) {
    if (r.humanLabel === "pass" && r.judgeVerdict === "pass") tp++;
    else if (r.humanLabel === "fail" && r.judgeVerdict === "fail") tn++;
    else if (r.humanLabel === "fail" && r.judgeVerdict === "pass") fp++;
    else if (r.humanLabel === "pass" && r.judgeVerdict === "fail") fn++;
  }

  const totalPass = tp + fn;
  const totalFail = tn + fp;
  const total = results.length;

  return {
    tpr: totalPass > 0 ? tp / totalPass : 1,
    tnr: totalFail > 0 ? tn / totalFail : 1,
    accuracy: total > 0 ? (tp + tn) / total : 1,
    total,
    tp,
    tn,
    fp,
    fn,
  };
}

/**
 * Rogan-Gladen correction: estimate true pass rate from observed pass rate
 * and judge's TPR/TNR.
 *
 * θ = (p_obs + TNR - 1) / (TPR + TNR - 1), clipped to [0, 1]
 */
export function correctedPassRate(
  pObs: number,
  tpr: number,
  tnr: number,
): number {
  const denom = tpr + tnr - 1;
  if (denom <= 0) {
    // Judge is no better than random — correction is invalid
    return pObs;
  }
  const theta = (pObs + tnr - 1) / denom;
  return Math.max(0, Math.min(1, theta));
}

/**
 * Bootstrap 95% confidence interval for the corrected pass rate.
 *
 * Resamples the test set (human label, judge prediction) pairs B times,
 * recomputes TPR/TNR each time, applies correction, and takes percentiles.
 */
export function bootstrapCI(
  testLabels: number[], // 0 = fail, 1 = pass
  testPreds: number[], // 0 = fail, 1 = pass
  pObs: number,
  B: number = 20000,
  seed: number = 42,
): { lower: number; upper: number } {
  const N = testLabels.length;
  if (N === 0) return { lower: 0, upper: 1 };

  // Simple seeded RNG for reproducible bootstrap
  let rngState = seed | 0;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const samples: number[] = [];

  for (let b = 0; b < B; b++) {
    // Bootstrap sample
    let pBoot = 0;
    let fBoot = 0;
    let tpBoot = 0;
    let tnBoot = 0;

    for (let i = 0; i < N; i++) {
      const idx = Math.floor(rng() * N);
      const lbl = testLabels[idx];
      const pred = testPreds[idx];

      if (lbl === 1) {
        pBoot++;
        if (pred === 1) tpBoot++;
      } else {
        fBoot++;
        if (pred === 0) tnBoot++;
      }
    }

    if (pBoot === 0 || fBoot === 0) continue;

    const tprStar = tpBoot / pBoot;
    const tnrStar = tnBoot / fBoot;
    const denomStar = tprStar + tnrStar - 1;

    if (denomStar <= 0) continue;

    const thetaStar = (pObs + tnrStar - 1) / denomStar;
    samples.push(Math.max(0, Math.min(1, thetaStar)));
  }

  if (samples.length === 0) return { lower: 0, upper: 1 };

  samples.sort((a, b) => a - b);

  const lowerIdx = Math.floor(0.025 * samples.length);
  const upperIdx = Math.min(
    Math.floor(0.975 * samples.length),
    samples.length - 1,
  );

  return {
    lower: samples[lowerIdx],
    upper: samples[upperIdx],
  };
}

/**
 * Wilson score interval (95%) for a binomial proportion.
 * More reliable than the normal approximation at small n and extreme p̂.
 * Returns the full [0, 1] interval when n === 0.
 */
export function wilsonCI(
  successes: number,
  n: number,
): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const z = 1.959963984540054; // 95% two-sided
  const z2 = z * z;
  const phat = successes / n;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Bootstrap 95% CI for Score B (corrected agent pass rate).
 *
 * Unlike `bootstrapCI`, this propagates BOTH sources of uncertainty:
 *   1. sampling uncertainty in the observed cohort pass rate (resample cohortPreds)
 *   2. uncertainty in the judge's TPR/TNR (resample the validation test pairs)
 * Each bootstrap draw recomputes the per-draw observed pass rate and TPR/TNR,
 * then applies the Rogan-Gladen correction. Returns the 2.5/97.5 percentiles.
 */
export function scoreBCI(
  cohortPreds: number[], // 0 = fail, 1 = pass (judge verdicts over the cohort)
  testLabels: number[], // 0 = fail, 1 = pass (human labels on the test split)
  testPreds: number[], // 0 = fail, 1 = pass (judge verdicts on the test split)
  B: number = 20000,
  seed: number = 42,
): { lower: number; upper: number } {
  const M = cohortPreds.length;
  const N = testLabels.length;
  if (M === 0 || N === 0) return { lower: 0, upper: 1 };

  let rngState = seed | 0;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const samples: number[] = [];

  for (let b = 0; b < B; b++) {
    // 1) resample cohort → p_obs*
    let passBoot = 0;
    for (let i = 0; i < M; i++) {
      const idx = Math.floor(rng() * M);
      if (cohortPreds[idx] === 1) passBoot++;
    }
    const pObsStar = passBoot / M;

    // 2) resample validation pairs → TPR*/TNR*
    let pCount = 0;
    let fCount = 0;
    let tpBoot = 0;
    let tnBoot = 0;
    for (let i = 0; i < N; i++) {
      const idx = Math.floor(rng() * N);
      const lbl = testLabels[idx];
      const pred = testPreds[idx];
      if (lbl === 1) {
        pCount++;
        if (pred === 1) tpBoot++;
      } else {
        fCount++;
        if (pred === 0) tnBoot++;
      }
    }
    if (pCount === 0 || fCount === 0) continue;

    const tprStar = tpBoot / pCount;
    const tnrStar = tnBoot / fCount;
    const denomStar = tprStar + tnrStar - 1;
    if (denomStar <= 0) continue;

    const thetaStar = (pObsStar + tnrStar - 1) / denomStar;
    samples.push(Math.max(0, Math.min(1, thetaStar)));
  }

  if (samples.length === 0) return { lower: 0, upper: 1 };
  samples.sort((a, b) => a - b);
  const lowerIdx = Math.floor(0.025 * samples.length);
  const upperIdx = Math.min(
    Math.floor(0.975 * samples.length),
    samples.length - 1,
  );
  return { lower: samples[lowerIdx], upper: samples[upperIdx] };
}
