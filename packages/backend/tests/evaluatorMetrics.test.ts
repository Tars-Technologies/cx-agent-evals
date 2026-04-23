import { describe, it, expect } from "vitest";
import {
  computeTPRTNR,
  correctedPassRate,
  bootstrapCI,
  type JudgmentPair,
} from "../convex/evaluator/metrics";

describe("computeTPRTNR", () => {
  it("returns perfect agreement when judge matches human on every trace", () => {
    const results: JudgmentPair[] = [
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "fail", judgeVerdict: "fail" },
      { humanLabel: "fail", judgeVerdict: "fail" },
    ];
    const r = computeTPRTNR(results);
    expect(r.tpr).toBe(1);
    expect(r.tnr).toBe(1);
    expect(r.accuracy).toBe(1);
    expect(r.total).toBe(4);
  });

  it("computes TPR and TNR correctly for mixed outcomes", () => {
    // 4 actual passes, 3 correctly called pass → TPR = 3/4
    // 4 actual fails, 2 correctly called fail → TNR = 2/4
    const results: JudgmentPair[] = [
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "pass", judgeVerdict: "fail" },
      { humanLabel: "fail", judgeVerdict: "fail" },
      { humanLabel: "fail", judgeVerdict: "fail" },
      { humanLabel: "fail", judgeVerdict: "pass" },
      { humanLabel: "fail", judgeVerdict: "pass" },
    ];
    const r = computeTPRTNR(results);
    expect(r.tpr).toBe(0.75);
    expect(r.tnr).toBe(0.5);
    expect(r.accuracy).toBe(5 / 8);
    expect(r.tp).toBe(3);
    expect(r.fn).toBe(1);
    expect(r.tn).toBe(2);
    expect(r.fp).toBe(2);
  });

  it("returns TPR=1 when there are no actual passes (avoids div-by-zero)", () => {
    const results: JudgmentPair[] = [
      { humanLabel: "fail", judgeVerdict: "fail" },
      { humanLabel: "fail", judgeVerdict: "pass" },
    ];
    const r = computeTPRTNR(results);
    expect(r.tpr).toBe(1);
    expect(r.tnr).toBe(0.5);
  });

  it("returns TNR=1 when there are no actual fails (avoids div-by-zero)", () => {
    const results: JudgmentPair[] = [
      { humanLabel: "pass", judgeVerdict: "pass" },
      { humanLabel: "pass", judgeVerdict: "fail" },
    ];
    const r = computeTPRTNR(results);
    expect(r.tpr).toBe(0.5);
    expect(r.tnr).toBe(1);
  });

  it("returns identity values on an empty input", () => {
    const r = computeTPRTNR([]);
    expect(r.total).toBe(0);
    expect(r.tpr).toBe(1);
    expect(r.tnr).toBe(1);
    expect(r.accuracy).toBe(1);
  });
});

describe("correctedPassRate (Rogan-Gladen)", () => {
  it("returns pObs unchanged when judge is perfect (TPR=TNR=1)", () => {
    expect(correctedPassRate(0.6, 1, 1)).toBeCloseTo(0.6, 10);
    expect(correctedPassRate(0.0, 1, 1)).toBeCloseTo(0.0, 10);
    expect(correctedPassRate(1.0, 1, 1)).toBeCloseTo(1.0, 10);
  });

  it("returns pObs when the judge is no better than random (denom <= 0)", () => {
    // denom = TPR + TNR - 1 = 0 → correction invalid
    expect(correctedPassRate(0.4, 0.5, 0.5)).toBe(0.4);
    // denom negative
    expect(correctedPassRate(0.4, 0.3, 0.3)).toBe(0.4);
  });

  it("clips the corrected rate to [0, 1]", () => {
    // Extreme inputs that would push theta > 1
    expect(correctedPassRate(1.0, 0.9, 0.1)).toBeLessThanOrEqual(1);
    expect(correctedPassRate(1.0, 0.9, 0.1)).toBeGreaterThanOrEqual(0);

    // Extreme input that would push theta < 0
    expect(correctedPassRate(0.0, 0.1, 0.9)).toBeGreaterThanOrEqual(0);
    expect(correctedPassRate(0.0, 0.1, 0.9)).toBeLessThanOrEqual(1);
  });

  it("corrects toward the true rate when the judge is biased", () => {
    // Judge over-calls pass: TPR=1 but TNR=0.5 → many fails slip through as pass
    // Observed 0.8 pass rate should be corrected downward.
    const corrected = correctedPassRate(0.8, 1.0, 0.5);
    expect(corrected).toBeLessThan(0.8);
  });
});

describe("bootstrapCI", () => {
  const perfectLabels = [1, 1, 1, 1, 0, 0, 0, 0];
  const perfectPreds = [1, 1, 1, 1, 0, 0, 0, 0];

  it("produces identical CIs for the same seed (determinism)", () => {
    const a = bootstrapCI(perfectLabels, perfectPreds, 0.5, 1000, 123);
    const b = bootstrapCI(perfectLabels, perfectPreds, 0.5, 1000, 123);
    expect(a.lower).toBe(b.lower);
    expect(a.upper).toBe(b.upper);
  });

  it("produces different CIs for different seeds (seed is actually used)", () => {
    // Construct a labeled dataset with a judge that is clearly better than
    // chance (TPR + TNR comfortably > 1), so the Rogan-Gladen denom is
    // positive in most bootstrap iterations and the percentile bounds are
    // sensitive to the sampled indices (i.e. to the seed).
    //
    // 20 passes / 20 fails; judge gets 80% of each correct.
    const labels: number[] = [];
    const preds: number[] = [];
    for (let i = 0; i < 20; i++) {
      labels.push(1);
      preds.push(i < 16 ? 1 : 0); // 16/20 correct → TPR = 0.8
    }
    for (let i = 0; i < 20; i++) {
      labels.push(0);
      preds.push(i < 16 ? 0 : 1); // 16/20 correct → TNR = 0.8
    }
    const a = bootstrapCI(labels, preds, 0.5, 2000, 1);
    const b = bootstrapCI(labels, preds, 0.5, 2000, 999);
    expect(a.lower !== b.lower || a.upper !== b.upper).toBe(true);
  });

  it("defaults to seed 42 when no seed is provided (backward compatible)", () => {
    const withDefault = bootstrapCI(perfectLabels, perfectPreds, 0.5, 500);
    const withExplicit = bootstrapCI(perfectLabels, perfectPreds, 0.5, 500, 42);
    expect(withDefault.lower).toBe(withExplicit.lower);
    expect(withDefault.upper).toBe(withExplicit.upper);
  });

  it("returns [0, 1] bounds for an empty test set", () => {
    const ci = bootstrapCI([], [], 0.5);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(1);
  });

  it("bounds are ordered and within [0, 1]", () => {
    const ci = bootstrapCI(perfectLabels, perfectPreds, 0.5, 500, 7);
    expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });
});
