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
} from "../../../src/experiments/presets.js";
import { RecursiveCharacterChunker } from "../../../src/chunkers/recursive-character.js";
import { InMemoryVectorStore } from "../../../src/vector-stores/in-memory.js";
import { createCorpus, createDocument } from "../../../src/types/documents.js";
import { mockEmbedder } from "../../fixtures.js";
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
