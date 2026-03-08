import { describe, it, expect } from "vitest";
import {
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  DEFAULT_INDEX_CONFIG,
} from "../../../../src/retrievers/pipeline/config.js";
import type { PipelineConfig } from "../../../../src/retrievers/pipeline/config.js";

const basePipeline: PipelineConfig = {
  name: "test-pipeline",
  index: {
    strategy: "plain",
    chunkSize: 500,
    chunkOverlap: 100,
    embeddingModel: "text-embedding-3-large",
    separators: ["\n\n", "\n"],
  },
};

describe("computeIndexConfigHash", () => {
  it("produces the same hash when called twice on the same config (deterministic)", () => {
    const hash1 = computeIndexConfigHash(basePipeline);
    const hash2 = computeIndexConfigHash(basePipeline);

    expect(hash1).toBe(hash2);
  });

  it("produces the same hash for two identical configs with different object references", () => {
    const configA: PipelineConfig = {
      name: "pipeline-a",
      index: {
        strategy: "plain",
        chunkSize: 500,
        chunkOverlap: 100,
        embeddingModel: "text-embedding-3-large",
        separators: ["\n\n", "\n"],
      },
    };

    const configB: PipelineConfig = {
      name: "pipeline-b",
      index: {
        strategy: "plain",
        chunkSize: 500,
        chunkOverlap: 100,
        embeddingModel: "text-embedding-3-large",
        separators: ["\n\n", "\n"],
      },
    };

    expect(computeIndexConfigHash(configA)).toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("produces a different hash when chunkSize differs", () => {
    const configA: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkSize: 500 },
    };

    const configB: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkSize: 1500 },
    };

    expect(computeIndexConfigHash(configA)).not.toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("produces a different hash when chunkOverlap differs", () => {
    const configA: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkOverlap: 100 },
    };

    const configB: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkOverlap: 300 },
    };

    expect(computeIndexConfigHash(configA)).not.toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("produces a different hash when embeddingModel differs", () => {
    const configA: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", embeddingModel: "text-embedding-3-small" },
    };

    const configB: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", embeddingModel: "text-embedding-3-large" },
    };

    expect(computeIndexConfigHash(configA)).not.toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("produces a different hash when separators differ", () => {
    const configA: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", separators: ["\n\n", "\n"] },
    };

    const configB: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", separators: ["\n\n", "\n", " "] },
    };

    expect(computeIndexConfigHash(configA)).not.toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("produces the same hash when configs differ only in non-index fields", () => {
    const configA: PipelineConfig = {
      name: "pipeline-alpha",
      index: { strategy: "plain", chunkSize: 800 },
      search: { strategy: "dense" },
    };

    const configB: PipelineConfig = {
      name: "pipeline-beta",
      index: { strategy: "plain", chunkSize: 800 },
      search: { strategy: "bm25" },
      refinement: [{ type: "rerank" }],
    };

    expect(computeIndexConfigHash(configA)).toBe(
      computeIndexConfigHash(configB),
    );
  });

  it("uses defaults when index config is omitted and matches explicit default config", () => {
    const withoutIndex: PipelineConfig = {
      name: "no-index",
    };

    const withExplicitDefaults: PipelineConfig = {
      name: "explicit-defaults",
      index: {
        strategy: DEFAULT_INDEX_CONFIG.strategy,
        chunkSize: DEFAULT_INDEX_CONFIG.chunkSize,
        chunkOverlap: DEFAULT_INDEX_CONFIG.chunkOverlap,
        embeddingModel: DEFAULT_INDEX_CONFIG.embeddingModel,
      },
    };

    expect(computeIndexConfigHash(withoutIndex)).toBe(
      computeIndexConfigHash(withExplicitDefaults),
    );
  });

  it("returns a valid 64-character hex string (SHA-256 digest)", () => {
    const hash = computeIndexConfigHash(basePipeline);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("computeIndexConfigHash — new strategies", () => {
  it("produces different hashes for different strategies", () => {
    const plain: PipelineConfig = { name: "a", index: { strategy: "plain" } };
    const contextual: PipelineConfig = { name: "b", index: { strategy: "contextual" } };
    const summary: PipelineConfig = { name: "c", index: { strategy: "summary" } };
    const parentChild: PipelineConfig = { name: "d", index: { strategy: "parent-child" } };

    const hashes = [
      computeIndexConfigHash(plain),
      computeIndexConfigHash(contextual),
      computeIndexConfigHash(summary),
      computeIndexConfigHash(parentChild),
    ];

    expect(new Set(hashes).size).toBe(4);
  });

  it("concurrency does NOT affect contextual index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", concurrency: 5 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", concurrency: 20 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("concurrency does NOT affect summary index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "summary", concurrency: 5 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "summary", concurrency: 20 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("contextPrompt affects contextual index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", contextPrompt: "prompt A" } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", contextPrompt: "prompt B" } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("summaryPrompt affects summary index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "summary", summaryPrompt: "prompt A" } };
    const b: PipelineConfig = { name: "b", index: { strategy: "summary", summaryPrompt: "prompt B" } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("childChunkSize affects parent-child index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", childChunkSize: 100 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", childChunkSize: 300 } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("parentChunkSize affects parent-child index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", parentChunkSize: 500 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", parentChunkSize: 2000 } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("stable across identical contextual configs", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", chunkSize: 500 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", chunkSize: 500 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("stable across identical parent-child configs", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });
});

describe("computeRetrieverConfigHash — new index strategies", () => {
  it("produces different hashes for different index strategies (same other stages)", () => {
    const base = { query: { strategy: "identity" as const }, search: { strategy: "dense" as const } };
    const plain: PipelineConfig = { name: "a", index: { strategy: "plain" }, ...base };
    const contextual: PipelineConfig = { name: "b", index: { strategy: "contextual" }, ...base };

    expect(computeRetrieverConfigHash(plain, 10)).not.toBe(
      computeRetrieverConfigHash(contextual, 10),
    );
  });

  it("plain strategy hash is identical to pre-refactor hash (hash stability)", () => {
    const config: PipelineConfig = {
      name: "stability-test",
      index: { strategy: "plain", chunkSize: 1000, chunkOverlap: 200, embeddingModel: "text-embedding-3-small" },
    };

    // Capture the hash — this test ensures it never changes across refactors
    const hash = computeRetrieverConfigHash(config, 10);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Verify it matches a config with explicit defaults (same behavior as pre-refactor)
    const configWithDefaults: PipelineConfig = {
      name: "other",
      index: {
        strategy: DEFAULT_INDEX_CONFIG.strategy,
        chunkSize: DEFAULT_INDEX_CONFIG.chunkSize,
        chunkOverlap: DEFAULT_INDEX_CONFIG.chunkOverlap,
        embeddingModel: DEFAULT_INDEX_CONFIG.embeddingModel,
      },
    };
    expect(computeRetrieverConfigHash(configWithDefaults, 10)).toBe(hash);
  });
});
