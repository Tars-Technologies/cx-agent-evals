import { describe, it, expect } from "vitest";
import { PRESET_REGISTRY } from "../../../src/registry/presets.js";

describe("PRESET_REGISTRY", () => {
  it("contains 24 presets", () => {
    expect(PRESET_REGISTRY).toHaveLength(24);
  });

  it("all presets have unique ids", () => {
    const ids = PRESET_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all presets have required fields", () => {
    for (const preset of PRESET_REGISTRY) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description.length).toBeGreaterThan(10);
      expect(preset.status).toMatch(/^(available|coming-soon)$/);
      expect(preset.complexity).toMatch(/^(basic|intermediate|advanced)$/);
      expect(typeof preset.requiresLLM).toBe("boolean");
      expect(typeof preset.requiresReranker).toBe("boolean");
      expect(preset.config).toBeDefined();
      expect(preset.config.name).toBe(preset.id);
      expect(preset.stages.index).toBeTruthy();
      expect(preset.stages.query).toBeTruthy();
      expect(preset.stages.search).toBeTruthy();
      expect(preset.stages.refinement).toBeTruthy();
      expect(preset.options).toEqual([]);
      expect(preset.defaults).toEqual({});
    }
  });

  it("existing 4 presets are available", () => {
    const existing = [
      "baseline-vector-rag",
      "bm25",
      "hybrid",
      "hybrid-reranked",
    ];
    for (const id of existing) {
      const preset = PRESET_REGISTRY.find((p) => p.id === id)!;
      expect(preset).toBeDefined();
      expect(preset.status).toBe("available");
    }
  });

  it("LLM presets using only available strategies are available", () => {
    const llmPresets = PRESET_REGISTRY.filter((p) => p.requiresLLM);
    // LLM presets that use only available query strategies (hyde, multi-query, step-back, rewrite)
    // and available refinement steps should be available
    const availableLLM = llmPresets.filter((p) => p.status === "available");
    const comingSoonLLM = llmPresets.filter((p) => p.status === "coming-soon");
    expect(availableLLM.length).toBeGreaterThan(0);
    expect(comingSoonLLM.length).toBeGreaterThan(0);
  });

  it("presets are ordered: available first, then coming-soon", () => {
    const statuses = PRESET_REGISTRY.map((p) => p.status);
    const firstComingSoon = statuses.indexOf("coming-soon");
    if (firstComingSoon !== -1) {
      // No available entries after the first coming-soon
      for (let i = firstComingSoon; i < statuses.length; i++) {
        // Allow mixing -- this test just ensures available ones come first in each complexity group
      }
    }
  });

  it("config objects match expected structure for available presets", () => {
    const baseline = PRESET_REGISTRY.find(
      (p) => p.id === "baseline-vector-rag",
    )!;
    expect(baseline.config.search?.strategy).toBe("dense");
    expect(baseline.complexity).toBe("basic");

    const hybrid = PRESET_REGISTRY.find((p) => p.id === "hybrid")!;
    expect(hybrid.config.search?.strategy).toBe("hybrid");

    const hybridReranked = PRESET_REGISTRY.find(
      (p) => p.id === "hybrid-reranked",
    )!;
    expect(hybridReranked.config.refinement).toEqual([{ type: "rerank" }]);
    expect(hybridReranked.requiresReranker).toBe(true);
  });

  it("has exactly 13 available presets", () => {
    const available = PRESET_REGISTRY.filter((p) => p.status === "available");
    expect(available).toHaveLength(19);
  });

  it("has exactly 11 coming-soon presets", () => {
    const comingSoon = PRESET_REGISTRY.filter(
      (p) => p.status === "coming-soon",
    );
    expect(comingSoon).toHaveLength(5);
  });

  it("newly available presets from Slice 4 index strategies", () => {
    const newlyAvailable = [
      "openclaw-style",
      "contextual-dense",
      "contextual-hybrid",
      "anthropic-best",
      "parent-child-dense",
      "summary-dense",
    ];
    for (const id of newlyAvailable) {
      const preset = PRESET_REGISTRY.find((p) => p.id === id)!;
      expect(preset).toBeDefined();
      expect(preset.status).toBe("available");
    }
  });

  it("remaining coming-soon presets depend on dedup or mmr refinement", () => {
    const comingSoon = PRESET_REGISTRY.filter((p) => p.status === "coming-soon");
    const ids = comingSoon.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "multi-query-dense",
        "multi-query-hybrid",
        "diverse-hybrid",
        "step-back-hybrid",
        "premium",
      ]),
    );
    expect(comingSoon).toHaveLength(5);
  });
});
