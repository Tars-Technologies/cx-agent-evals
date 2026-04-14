import { describe, it, expect } from "vitest";
import { calculateQuotas } from "../../../../src/synthetic-datagen/unified/quota.js";

describe("calculateQuotas", () => {
  it("distributes proportionally by priority", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 3 },
      { id: "c", priority: 2 },
    ];
    const result = calculateQuotas(docs, 20);
    // total weight = 10, a=50%, b=30%, c=20%
    expect(result.get("a")).toBe(10);
    expect(result.get("b")).toBe(6);
    expect(result.get("c")).toBe(4);
    // Sum must equal totalQuestions
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(20);
  });

  it("gives remainder to highest-priority doc", () => {
    const docs = [
      { id: "a", priority: 3 },
      { id: "b", priority: 3 },
      { id: "c", priority: 3 },
    ];
    // 10 / 3 = 3.33 each. Can't divide evenly.
    const result = calculateQuotas(docs, 10);
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
  });

  it("skips low-priority docs when totalQuestions < numDocs", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 3 },
      { id: "c", priority: 1 },
    ];
    const result = calculateQuotas(docs, 2);
    expect(result.get("a")).toBeGreaterThan(0);
    expect(result.get("b")).toBeGreaterThan(0);
    expect(result.get("c")).toBe(0);
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(2);
  });

  it("uses allocation overrides when provided", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 1 },
    ];
    const result = calculateQuotas(docs, 20, { a: 75, b: 25 });
    expect(result.get("a")).toBe(15);
    expect(result.get("b")).toBe(5);
  });

  it("handles single document", () => {
    const result = calculateQuotas([{ id: "a", priority: 3 }], 20);
    expect(result.get("a")).toBe(20);
  });

  it("defaults priority to 3 when not set", () => {
    const docs = [
      { id: "a", priority: 3 },
      { id: "b", priority: 3 },
    ];
    const result = calculateQuotas(docs, 10);
    expect(result.get("a")).toBe(5);
    expect(result.get("b")).toBe(5);
  });
});
