import { describe, it, expect } from "vitest";
import { RERANKER_REGISTRY } from "../../../src/registry/rerankers.js";

describe("RERANKER_REGISTRY", () => {
  it("contains all 3 providers", () => {
    const ids = RERANKER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["cohere", "jina", "voyage"]);
  });

  it("all entries have required fields", () => {
    for (const entry of RERANKER_REGISTRY) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.status).toBe("available");
      expect(entry.options.length).toBeGreaterThan(0);
      for (const opt of entry.options) {
        expect(entry.defaults).toHaveProperty(opt.key);
      }
    }
  });

  it("cohere has correct models", () => {
    const cohere = RERANKER_REGISTRY.find((e) => e.id === "cohere")!;
    const modelOpt = cohere.options.find((o) => o.key === "model")!;
    const values = modelOpt.choices!.map((c) => c.value);
    expect(values).toContain("rerank-english-v3.0");
    expect(values).toContain("rerank-v3.5");
  });
});
