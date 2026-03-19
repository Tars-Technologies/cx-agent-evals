import { describe, it, expect, afterEach } from "vitest";
import {
  createBaselineVectorRagRetriever,
  BASELINE_VECTOR_RAG_CONFIG,
  createBM25Retriever,
  BM25_CONFIG,
  createHybridRetriever,
  HYBRID_CONFIG,
  createHybridRerankedRetriever,
  HYBRID_RERANKED_CONFIG,
  createPresetRetriever,
} from "../../../src/experiments/presets.js";
import type { PipelinePresetDeps } from "../../../src/experiments/presets.js";
import { RecursiveCharacterChunker } from "../../../src/chunkers/recursive-character.js";
import { InMemoryVectorStore } from "../../../src/vector-stores/in-memory.js";
import { createCorpus, createDocument } from "../../../src/types/documents.js";
import { mockEmbedder, mockLLM } from "../../fixtures.js";
import type { Reranker } from "../../../src/rerankers/reranker.interface.js";
import type { PositionAwareChunk } from "../../../src/types/index.js";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const corpus = createCorpus([
  createDocument({
    id: "animals.md",
    content:
      "Dogs and cats are popular pets. Dogs are loyal companions. Cats are independent creatures that enjoy solitude.",
  }),
  createDocument({
    id: "food.md",
    content:
      "Pasta is a staple food in Italian cuisine. Spaghetti and penne are common pasta shapes used in many dishes.",
  }),
]);

const chunker = new RecursiveCharacterChunker({ chunkSize: 60, chunkOverlap: 10 });
const embedder = mockEmbedder(32);

const mockReranker: Reranker = {
  name: "MockReranker",
  async rerank(_query: string, chunks: readonly PositionAwareChunk[], topK?: number) {
    const reversed = [...chunks].reverse();
    return topK ? reversed.slice(0, topK) : reversed;
  },
};

// ---------------------------------------------------------------------------
// createBaselineVectorRagRetriever
// ---------------------------------------------------------------------------

describe("createBaselineVectorRagRetriever", () => {
  let retriever: ReturnType<typeof createBaselineVectorRagRetriever> | undefined;

  afterEach(async () => {
    if (retriever) {
      await retriever.cleanup();
      retriever = undefined;
    }
  });

  it('creates a retriever with the correct name "baseline-vector-rag"', () => {
    retriever = createBaselineVectorRagRetriever({ chunker, embedder });
    expect(retriever.name).toBe("baseline-vector-rag");
  });

  it("init + retrieve returns chunks", async () => {
    retriever = createBaselineVectorRagRetriever({ chunker, embedder });
    await retriever.init(corpus);

    const results = await retriever.retrieve("dogs", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it("config override: can set a custom name", () => {
    retriever = createBaselineVectorRagRetriever({ chunker, embedder }, { name: "my-custom-rag" });
    expect(retriever.name).toBe("my-custom-rag");
  });

  it('config has correct defaults (search.strategy === "dense")', () => {
    expect(BASELINE_VECTOR_RAG_CONFIG.search).toBeDefined();
    expect(BASELINE_VECTOR_RAG_CONFIG.search!.strategy).toBe("dense");
  });
});

// ---------------------------------------------------------------------------
// createBM25Retriever
// ---------------------------------------------------------------------------

describe("createBM25Retriever", () => {
  let retriever: ReturnType<typeof createBM25Retriever> | undefined;

  afterEach(async () => {
    if (retriever) {
      await retriever.cleanup();
      retriever = undefined;
    }
  });

  it('creates a retriever with name "bm25"', () => {
    retriever = createBM25Retriever({ chunker, embedder });
    expect(retriever.name).toBe("bm25");
  });

  it("init + retrieve returns chunks for keyword query", async () => {
    retriever = createBM25Retriever({ chunker, embedder });
    await retriever.init(corpus);

    const results = await retriever.retrieve("pasta Italian cuisine", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it('config has BM25 search strategy (search.strategy === "bm25")', () => {
    expect(BM25_CONFIG.search).toBeDefined();
    expect(BM25_CONFIG.search!.strategy).toBe("bm25");
  });
});

// ---------------------------------------------------------------------------
// createHybridRetriever
// ---------------------------------------------------------------------------

describe("createHybridRetriever", () => {
  let retriever: ReturnType<typeof createHybridRetriever> | undefined;

  afterEach(async () => {
    if (retriever) {
      await retriever.cleanup();
      retriever = undefined;
    }
  });

  it('creates a retriever with name "hybrid"', () => {
    retriever = createHybridRetriever({ chunker, embedder });
    expect(retriever.name).toBe("hybrid");
  });

  it("init + retrieve returns chunks", async () => {
    retriever = createHybridRetriever({ chunker, embedder });
    await retriever.init(corpus);

    const results = await retriever.retrieve("dogs and cats pets", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it("config has correct weights (denseWeight and sparseWeight)", () => {
    expect(HYBRID_CONFIG.search).toBeDefined();
    expect(HYBRID_CONFIG.search!.strategy).toBe("hybrid");

    const search = HYBRID_CONFIG.search as { denseWeight?: number; sparseWeight?: number };
    expect(search.denseWeight).toBe(0.7);
    expect(search.sparseWeight).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// createHybridRerankedRetriever
// ---------------------------------------------------------------------------

describe("createHybridRerankedRetriever", () => {
  let retriever: ReturnType<typeof createHybridRerankedRetriever> | undefined;

  afterEach(async () => {
    if (retriever) {
      await retriever.cleanup();
      retriever = undefined;
    }
  });

  it('creates a retriever with name "hybrid-reranked"', () => {
    retriever = createHybridRerankedRetriever({ chunker, embedder, reranker: mockReranker });
    expect(retriever.name).toBe("hybrid-reranked");
  });

  it("requires reranker in deps (construct with mock reranker succeeds)", () => {
    expect(() => {
      retriever = createHybridRerankedRetriever({ chunker, embedder, reranker: mockReranker });
    }).not.toThrow();
    expect(retriever).toBeDefined();
    expect(retriever!.name).toBe("hybrid-reranked");
  });

  it("init + retrieve returns chunks", async () => {
    retriever = createHybridRerankedRetriever({ chunker, embedder, reranker: mockReranker });
    await retriever.init(corpus);

    const results = await retriever.retrieve("popular pets dogs", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it("config includes rerank refinement step", () => {
    expect(HYBRID_RERANKED_CONFIG.refinement).toBeDefined();
    expect(HYBRID_RERANKED_CONFIG.refinement!.length).toBeGreaterThan(0);

    const rerankStep = HYBRID_RERANKED_CONFIG.refinement!.find((step) => step.type === "rerank");
    expect(rerankStep).toBeDefined();
    expect(rerankStep!.type).toBe("rerank");
  });
});

// ---------------------------------------------------------------------------
// createPresetRetriever — registry-backed factory (all available presets)
// ---------------------------------------------------------------------------

describe("createPresetRetriever (registry-backed factory)", () => {
  const baseDeps: PipelinePresetDeps = { chunker, embedder };
  const depsWithReranker: PipelinePresetDeps = { ...baseDeps, reranker: mockReranker };
  const llm = mockLLM();
  const depsWithLlm: PipelinePresetDeps = { ...baseDeps, llm };
  const fullDeps: PipelinePresetDeps = { ...baseDeps, reranker: mockReranker, llm };

  // Presets that need NO LLM and NO reranker
  const basicPresets = [
    "baseline-vector-rag",
    "bm25",
    "hybrid",
    "hybrid-rrf",
    "openclaw-style",
    "parent-child-dense",
    "diverse-hybrid",
  ] as const;

  // Presets that need reranker only
  const rerankerOnlyPresets = [
    "dense-reranked",
    "bm25-reranked",
    "hybrid-reranked",
    "hybrid-rrf-reranked",
  ] as const;

  // Presets that need LLM only
  const llmOnlyPresets = [
    "hyde-dense",
    "hyde-hybrid",
    "contextual-dense",
    "contextual-hybrid",
    "summary-dense",
    "rewrite-hybrid",
    "multi-query-dense",
  ] as const;

  // Presets that need both LLM and reranker
  const llmAndRerankerPresets = [
    "hyde-hybrid-reranked",
    "anthropic-best",
    "rewrite-hybrid-reranked",
    "multi-query-hybrid",
    "step-back-hybrid",
    "premium",
  ] as const;

  const allPresetNames = [
    ...basicPresets,
    ...rerankerOnlyPresets,
    ...llmOnlyPresets,
    ...llmAndRerankerPresets,
  ];

  it("factory serves all 24 available presets", () => {
    expect(allPresetNames).toHaveLength(24);
  });

  it.each(basicPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with base deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, baseDeps);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(rerankerOnlyPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with reranker deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, depsWithReranker);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(llmOnlyPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with llm deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, depsWithLlm);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(llmAndRerankerPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with full deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, fullDeps);
      expect(retriever.name).toBe(name);
    },
  );

  // Dependency validation
  it.each(rerankerOnlyPresets.map((n) => ({ name: n })))(
    "$name throws without reranker",
    ({ name }) => {
      expect(() => createPresetRetriever(name, baseDeps)).toThrow(/reranker/i);
    },
  );

  it.each(llmOnlyPresets.map((n) => ({ name: n })))(
    "$name throws without llm",
    ({ name }) => {
      expect(() => createPresetRetriever(name, baseDeps)).toThrow(/LLM/i);
    },
  );

  it.each(llmAndRerankerPresets.map((n) => ({ name: n })))(
    "$name throws without llm (even with reranker)",
    ({ name }) => {
      expect(() => createPresetRetriever(name, depsWithReranker)).toThrow(/LLM/i);
    },
  );

  it("throws for unknown preset name", () => {
    expect(() => createPresetRetriever("nonexistent", baseDeps)).toThrow(/Unknown or unavailable/);
  });

  it("premium preset creates a retriever with full deps", () => {
    const retriever = createPresetRetriever("premium", fullDeps);
    expect(retriever.name).toBe("premium");
  });

  it("name override works via overrides parameter", () => {
    const retriever = createPresetRetriever("hybrid-rrf", baseDeps, {
      name: "custom-name",
    });
    expect(retriever.name).toBe("custom-name");
  });
});
