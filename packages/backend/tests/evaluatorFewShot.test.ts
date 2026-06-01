import { describe, it, expect } from "vitest";
import { renderFewShotBlock, selectFewShot } from "../convex/evaluator/fewShot";

describe("renderFewShotBlock", () => {
  it("renders labeled transcript examples with verdicts", () => {
    const block = renderFewShotBlock([
      { label: "fail", messages: [{ role: "user", content: "refund?" }, { role: "assistant", content: "instant refund!" }] },
      { label: "pass", messages: [{ role: "user", content: "refund?" }, { role: "assistant", content: "let me check policy" }] },
    ]);
    expect(block).toContain("Verdict: fail");
    expect(block).toContain("Verdict: pass");
    expect(block).toContain("instant refund!");
    expect(block).toContain("let me check policy");
  });

  it("returns an empty string for no examples", () => {
    expect(renderFewShotBlock([])).toBe("");
  });

  it("truncates very long transcripts to keep the prompt bounded", () => {
    const long = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `line ${i}` }));
    const block = renderFewShotBlock([{ label: "pass", messages: long }]);
    expect(block.length).toBeLessThan(4000);
  });
});

describe("selectFewShot", () => {
  it("returns a bounded, balanced id set", () => {
    const ids = selectFewShot(["p1", "p2", "p3"], ["f1", "f2"], 4, 1);
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(ids.every((id) => ["p1", "p2", "p3", "f1", "f2"].includes(id))).toBe(true);
  });
});
