import { describe, it, expect } from "vitest";
import { EMBEDDER_REGISTRY } from "../../../src/registry/embedders.js";

describe("EMBEDDER_REGISTRY", () => {
  it("contains all 4 providers", () => {
    const ids = EMBEDDER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["openai", "cohere", "voyage", "jina"]);
  });

  it("all entries have required fields", () => {
    for (const entry of EMBEDDER_REGISTRY) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.status).toMatch(/^(available|coming-soon)$/);
      expect(entry.options.length).toBeGreaterThan(0);
      // every option has a matching default
      for (const opt of entry.options) {
        expect(entry.defaults).toHaveProperty(opt.key);
      }
    }
  });

  it("openai has correct models", () => {
    const openai = EMBEDDER_REGISTRY.find((e) => e.id === "openai")!;
    expect(openai.status).toBe("available");
    const modelOpt = openai.options.find((o) => o.key === "model")!;
    expect(modelOpt.type).toBe("select");
    const values = modelOpt.choices!.map((c) => c.value);
    expect(values).toContain("text-embedding-3-small");
    expect(values).toContain("text-embedding-3-large");
  });

  it("all implemented providers are status available", () => {
    for (const entry of EMBEDDER_REGISTRY) {
      expect(entry.status).toBe("available");
    }
  });
});
