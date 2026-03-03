import { describe, it, expect } from "vitest";
import { applyResult, counterPatch } from "../convex/lib/workpool";

describe("applyResult", () => {
  const baseJob = {
    processedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    failedItemDetails: [] as Array<{ itemKey: string; error: string }>,
  };

  it("increments processedItems on success", () => {
    const result = applyResult(
      baseJob,
      { kind: "success", returnValue: {}, id: "w1" } as any,
      "item1",
    );
    expect(result.processedItems).toBe(1);
    expect(result.failedItems).toBe(0);
    expect(result.skippedItems).toBe(0);
  });

  it("increments failedItems on failure and records details", () => {
    const result = applyResult(
      baseJob,
      { kind: "failed", error: "boom", id: "w1" } as any,
      "item1",
    );
    expect(result.failedItems).toBe(1);
    expect(result.failedItemDetails).toEqual([{ itemKey: "item1", error: "boom" }]);
  });

  it("increments skippedItems on cancel", () => {
    const result = applyResult(
      baseJob,
      { kind: "canceled", id: "w1" } as any,
      "item1",
    );
    expect(result.skippedItems).toBe(1);
  });

  it("preserves existing counters", () => {
    const existingJob = {
      processedItems: 5,
      failedItems: 2,
      skippedItems: 1,
      failedItemDetails: [{ itemKey: "old", error: "err" }],
    };
    const result = applyResult(
      existingJob,
      { kind: "success", returnValue: {}, id: "w1" } as any,
      "new",
    );
    expect(result.processedItems).toBe(6);
    expect(result.failedItems).toBe(2);
    expect(result.failedItemDetails).toHaveLength(1); // no new failures
  });

  it("does not mutate the original job object", () => {
    const originalJob = {
      processedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      failedItemDetails: [{ itemKey: "existing", error: "err" }],
    };
    applyResult(
      originalJob,
      { kind: "failed", error: "new error", id: "w1" } as any,
      "item2",
    );
    // Original should be unchanged
    expect(originalJob.failedItems).toBe(0);
    expect(originalJob.failedItemDetails).toHaveLength(1);
  });
});

describe("counterPatch", () => {
  it("returns undefined for empty failedItemDetails", () => {
    const patch = counterPatch({
      processedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      failedItemDetails: [],
    });
    expect(patch.failedItemDetails).toBeUndefined();
  });

  it("preserves non-empty failedItemDetails", () => {
    const details = [{ itemKey: "x", error: "err" }];
    const patch = counterPatch({
      processedItems: 0,
      failedItems: 1,
      skippedItems: 0,
      failedItemDetails: details,
    });
    expect(patch.failedItemDetails).toEqual(details);
  });

  it("passes through counter values", () => {
    const patch = counterPatch({
      processedItems: 3,
      failedItems: 1,
      skippedItems: 2,
      failedItemDetails: [],
    });
    expect(patch.processedItems).toBe(3);
    expect(patch.failedItems).toBe(1);
    expect(patch.skippedItems).toBe(2);
  });
});
