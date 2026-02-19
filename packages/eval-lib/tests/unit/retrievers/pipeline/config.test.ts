import { describe, it, expect } from "vitest";
import {
  computeIndexConfigHash,
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
