import { describe, it, expect } from "vitest";
import { computeSplit, stratifiedFewShot } from "../convex/evaluator/splits";

const defaultConfig = { trainPct: 60, devPct: 20, testPct: 20 };

describe("computeSplit (stratified)", () => {
  it("represents the rare class in every split when stratified", () => {
    // 3 fails, 30 passes — without stratification, fails often only land in
    // one split. With stratification each class is split independently so
    // fails appear in train, dev, and test.
    const ids = Array.from({ length: 33 }, (_, i) => `q${i}`);
    const labels = new Map<string, "pass" | "fail">();
    for (let i = 0; i < 30; i++) labels.set(`q${i}`, "pass");
    for (let i = 30; i < 33; i++) labels.set(`q${i}`, "fail");

    const split = computeSplit(ids, defaultConfig, 42, labels);

    // Each split should contain at least one fail (the rare class).
    const failsInTrain = split.train.filter(
      (id) => labels.get(id) === "fail",
    ).length;
    const failsInDev = split.dev.filter(
      (id) => labels.get(id) === "fail",
    ).length;
    const failsInTest = split.test.filter(
      (id) => labels.get(id) === "fail",
    ).length;

    expect(failsInTrain).toBeGreaterThanOrEqual(1);
    expect(failsInDev + failsInTest).toBeGreaterThanOrEqual(1);
    // All 3 fails are accounted for across the splits
    expect(failsInTrain + failsInDev + failsInTest).toBe(3);
  });

  it("produces the same split for the same seed (determinism)", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `q${i}`);
    const labels = new Map<string, "pass" | "fail">();
    for (let i = 0; i < 20; i++)
      labels.set(`q${i}`, i % 3 === 0 ? "fail" : "pass");

    const a = computeSplit(ids, defaultConfig, 7, labels);
    const b = computeSplit(ids, defaultConfig, 7, labels);

    expect(a.train).toEqual(b.train);
    expect(a.dev).toEqual(b.dev);
    expect(a.test).toEqual(b.test);
  });

  it("produces a different split for a different seed", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `q${i}`);
    const labels = new Map<string, "pass" | "fail">();
    for (let i = 0; i < 20; i++)
      labels.set(`q${i}`, i % 2 === 0 ? "fail" : "pass");

    const a = computeSplit(ids, defaultConfig, 1, labels);
    const b = computeSplit(ids, defaultConfig, 999, labels);

    // At least one of the splits should differ
    const same =
      JSON.stringify(a.train) === JSON.stringify(b.train) &&
      JSON.stringify(a.dev) === JSON.stringify(b.dev) &&
      JSON.stringify(a.test) === JSON.stringify(b.test);
    expect(same).toBe(false);
  });

  it("returns empty splits on empty input", () => {
    const split = computeSplit([], defaultConfig, 42);
    expect(split.train).toEqual([]);
    expect(split.dev).toEqual([]);
    expect(split.test).toEqual([]);
  });

  it("falls back to flat random split when no labels provided", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `q${i}`);
    const split = computeSplit(ids, defaultConfig, 42);
    expect(split.train.length + split.dev.length + split.test.length).toBe(10);
  });
});

describe("stratifiedFewShot", () => {
  it("balances pass/fail 50/50 when both classes are abundant", () => {
    const passes = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const fails = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const result = stratifiedFewShot(passes, fails, 8, 42);

    expect(result.ids.length).toBe(8);
    expect(result.passCount).toBe(4);
    expect(result.failCount).toBe(4);
  });

  it("fills from the larger class when one class is short", () => {
    const passes = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const fails = ["f0", "f1"]; // only 2 fails available
    const result = stratifiedFewShot(passes, fails, 8, 42);

    // Takes all 2 fails, fills remaining 6 from passes
    expect(result.ids.length).toBe(8);
    expect(result.failCount).toBe(2);
    expect(result.passCount).toBe(6);
  });

  it("handles single-class input (all passes, no fails)", () => {
    const passes = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const result = stratifiedFewShot(passes, [], 5, 42);

    expect(result.ids.length).toBe(5);
    expect(result.passCount).toBe(5);
    expect(result.failCount).toBe(0);
  });

  it("returns empty when target count is zero", () => {
    const result = stratifiedFewShot(["p1"], ["f1"], 0, 42);
    expect(result.ids).toEqual([]);
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it("returns empty when both pools are empty", () => {
    const result = stratifiedFewShot([], [], 8, 42);
    expect(result.ids).toEqual([]);
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  it("never exceeds the target count", () => {
    const passes = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const fails = Array.from({ length: 100 }, (_, i) => `f${i}`);
    const result = stratifiedFewShot(passes, fails, 5, 42);
    expect(result.ids.length).toBe(5);
  });

  it("produces deterministic output for the same seed", () => {
    const passes = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const fails = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const a = stratifiedFewShot(passes, fails, 6, 7);
    const b = stratifiedFewShot(passes, fails, 6, 7);
    expect(a.ids).toEqual(b.ids);
  });

  it("interleaves pass/fail in the output order", () => {
    const passes = ["p0", "p1", "p2"];
    const fails = ["f0", "f1", "f2"];
    const result = stratifiedFewShot(passes, fails, 6, 42);
    // First two items should be one pass and one fail (in either order)
    const firstTwo = result.ids.slice(0, 2);
    const hasPass = firstTwo.some((id) => id.startsWith("p"));
    const hasFail = firstTwo.some((id) => id.startsWith("f"));
    expect(hasPass && hasFail).toBe(true);
  });
});
