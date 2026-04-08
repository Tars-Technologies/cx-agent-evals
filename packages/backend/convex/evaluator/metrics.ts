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
): { lower: number; upper: number } {
  const N = testLabels.length;
  if (N === 0) return { lower: 0, upper: 1 };

  // Simple seeded RNG for reproducible bootstrap
  let rngState = 42;
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
