import { describe, it, expect } from "vitest";
import { CHUNKER_REGISTRY } from "../../../src/registry/chunkers.js";
import { INDEX_STRATEGY_REGISTRY } from "../../../src/registry/index-strategies.js";
import { QUERY_STRATEGY_REGISTRY } from "../../../src/registry/query-strategies.js";
import { SEARCH_STRATEGY_REGISTRY } from "../../../src/registry/search-strategies.js";
import { REFINEMENT_STEP_REGISTRY } from "../../../src/registry/refinement-steps.js";

function assertValidRegistry(
  registry: readonly {
    id: string;
    name: string;
    description: string;
    status: string;
    options: readonly { key: string; default: unknown }[];
    defaults: Record<string, unknown>;
  }[],
) {
  for (const entry of registry) {
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBeTruthy();
    expect(entry.description.length).toBeGreaterThan(10);
    expect(entry.status).toMatch(/^(available|coming-soon)$/);
    for (const opt of entry.options) {
      expect(entry.defaults).toHaveProperty(opt.key);
    }
  }
}

describe("CHUNKER_REGISTRY", () => {
  it("contains all 7 chunker types", () => {
    const ids = CHUNKER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual([
      "recursive-character",
      "sentence",
      "token",
      "markdown",
      "semantic",
      "cluster-semantic",
      "llm-semantic",
    ]);
  });

  it("sync chunkers are available, async are coming-soon", () => {
    const available = CHUNKER_REGISTRY.filter(
      (e) => e.status === "available",
    ).map((e) => e.id);
    const comingSoon = CHUNKER_REGISTRY.filter(
      (e) => e.status === "coming-soon",
    ).map((e) => e.id);
    expect(available).toEqual([
      "recursive-character",
      "sentence",
      "token",
      "markdown",
    ]);
    expect(comingSoon).toEqual([
      "semantic",
      "cluster-semantic",
      "llm-semantic",
    ]);
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(CHUNKER_REGISTRY);
  });
});

describe("INDEX_STRATEGY_REGISTRY", () => {
  it("contains all 4 strategies", () => {
    const ids = INDEX_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["plain", "contextual", "summary", "parent-child"]);
  });

  it("only plain is available", () => {
    expect(
      INDEX_STRATEGY_REGISTRY.find((e) => e.id === "plain")!.status,
    ).toBe("available");
    for (const entry of INDEX_STRATEGY_REGISTRY.filter(
      (e) => e.id !== "plain",
    )) {
      expect(entry.status).toBe("coming-soon");
    }
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(INDEX_STRATEGY_REGISTRY);
  });
});

describe("QUERY_STRATEGY_REGISTRY", () => {
  it("contains all 5 strategies", () => {
    const ids = QUERY_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual([
      "identity",
      "hyde",
      "multi-query",
      "step-back",
      "rewrite",
    ]);
  });

  it("all 5 query strategies are available", () => {
    for (const entry of QUERY_STRATEGY_REGISTRY) {
      expect(entry.status).toBe("available");
    }
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(QUERY_STRATEGY_REGISTRY);
  });
});

describe("SEARCH_STRATEGY_REGISTRY", () => {
  it("contains all 3 strategies, all available", () => {
    const ids = SEARCH_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["dense", "bm25", "hybrid"]);
    for (const entry of SEARCH_STRATEGY_REGISTRY) {
      expect(entry.status).toBe("available");
    }
  });

  it("hybrid has weight and fusion options", () => {
    const hybrid = SEARCH_STRATEGY_REGISTRY.find((e) => e.id === "hybrid")!;
    const keys = hybrid.options.map((o) => o.key);
    expect(keys).toContain("denseWeight");
    expect(keys).toContain("sparseWeight");
    expect(keys).toContain("fusionMethod");
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(SEARCH_STRATEGY_REGISTRY);
  });
});

describe("REFINEMENT_STEP_REGISTRY", () => {
  it("contains all 5 step types", () => {
    const ids = REFINEMENT_STEP_REGISTRY.map((e) => e.id);
    expect(ids).toEqual([
      "rerank",
      "threshold",
      "dedup",
      "mmr",
      "expand-context",
    ]);
  });

  it("rerank and threshold are available, others coming-soon", () => {
    expect(
      REFINEMENT_STEP_REGISTRY.find((e) => e.id === "rerank")!.status,
    ).toBe("available");
    expect(
      REFINEMENT_STEP_REGISTRY.find((e) => e.id === "threshold")!.status,
    ).toBe("available");
    expect(
      REFINEMENT_STEP_REGISTRY.find((e) => e.id === "dedup")!.status,
    ).toBe("coming-soon");
    expect(
      REFINEMENT_STEP_REGISTRY.find((e) => e.id === "mmr")!.status,
    ).toBe("coming-soon");
    expect(
      REFINEMENT_STEP_REGISTRY.find((e) => e.id === "expand-context")!.status,
    ).toBe("coming-soon");
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(REFINEMENT_STEP_REGISTRY);
  });
});
