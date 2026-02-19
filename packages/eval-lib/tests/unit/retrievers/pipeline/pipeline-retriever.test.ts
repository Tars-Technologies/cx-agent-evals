import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PipelineRetriever } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineRetrieverDeps } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineConfig } from "../../../../src/retrievers/pipeline/config.js";
import type { Reranker } from "../../../../src/rerankers/reranker.interface.js";
import type { PositionAwareChunk, Corpus } from "../../../../src/types/index.js";
import { createCorpus, createDocument } from "../../../../src/types/documents.js";
import { RecursiveCharacterChunker } from "../../../../src/chunkers/recursive-character.js";
import { mockEmbedder } from "../../../fixtures.js";

// ---------------------------------------------------------------------------
// Shared test corpus — three topically distinct documents
// ---------------------------------------------------------------------------

function testCorpus(): Corpus {
  return createCorpus([
    createDocument({
      id: "animals.md",
      content:
        "Dogs and cats are popular pets. Dogs are loyal companions. Cats are independent creatures.",
    }),
    createDocument({
      id: "programming.md",
      content:
        "TypeScript is a typed superset of JavaScript. It compiles to plain JavaScript and adds optional static typing.",
    }),
    createDocument({
      id: "cooking.md",
      content:
        "Pasta is a staple food in Italian cuisine. Spaghetti and penne are popular pasta shapes.",
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Shared dependencies factory
// ---------------------------------------------------------------------------

function defaultDeps(overrides?: Partial<PipelineRetrieverDeps>): PipelineRetrieverDeps {
  return {
    chunker: new RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 10 }),
    embedder: mockEmbedder(128),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock reranker — reverses order for deterministic testing
// ---------------------------------------------------------------------------

const mockReranker: Reranker = {
  name: "MockReranker",
  async rerank(_query, chunks, topK) {
    const reversed = [...chunks].reverse();
    return topK ? reversed.slice(0, topK) : reversed;
  },
};

// ---------------------------------------------------------------------------
// 1. Dense search pipeline
// ---------------------------------------------------------------------------

describe("PipelineRetriever — dense search", () => {
  const config: PipelineConfig = {
    name: "dense-test",
    search: { strategy: "dense" },
  };

  let retriever: PipelineRetriever;
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("returns chunks after init + retrieve", async () => {
    const results = await retriever.retrieve("dogs and cats", 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it("returns PositionAwareChunk[] with required fields", async () => {
    const results = await retriever.retrieve("TypeScript", 3);

    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
      expect(typeof chunk.id).toBe("string");
      expect(typeof chunk.content).toBe("string");
      expect(typeof chunk.docId).toBe("string");
      expect(typeof chunk.start).toBe("number");
      expect(typeof chunk.end).toBe("number");
    }
  });

  it("k parameter limits number of results", async () => {
    const resultsK2 = await retriever.retrieve("popular pets food", 2);
    const resultsK10 = await retriever.retrieve("popular pets food", 10);

    expect(resultsK2.length).toBeLessThanOrEqual(2);
    expect(resultsK10.length).toBeGreaterThanOrEqual(resultsK2.length);
  });

  it("throws when retrieve is called before init", async () => {
    const uninitRetriever = new PipelineRetriever(config, defaultDeps());

    await expect(uninitRetriever.retrieve("test", 5)).rejects.toThrow(
      "PipelineRetriever not initialized. Call init() first.",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. BM25 search pipeline
// ---------------------------------------------------------------------------

describe("PipelineRetriever — BM25 search", () => {
  const config: PipelineConfig = {
    name: "bm25-test",
    search: { strategy: "bm25" },
  };

  let retriever: PipelineRetriever;
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("returns chunks matching a keyword query", async () => {
    const results = await retriever.retrieve("dogs cats pets", 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it("returns cooking-related chunks for pasta query", async () => {
    const results = await retriever.retrieve("pasta spaghetti", 5);

    expect(results.length).toBeGreaterThan(0);

    const hasCookingChunk = results.some(
      (chunk) => chunk.docId === "cooking.md",
    );
    expect(hasCookingChunk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Hybrid search pipeline
// ---------------------------------------------------------------------------

describe("PipelineRetriever — hybrid search", () => {
  const config: PipelineConfig = {
    name: "hybrid-test",
    search: { strategy: "hybrid" },
  };

  let retriever: PipelineRetriever;
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("returns chunks after init + retrieve", async () => {
    const results = await retriever.retrieve("Italian food", 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it("finds relevant chunks by combining dense and BM25", async () => {
    const results = await retriever.retrieve("TypeScript JavaScript typing", 5);

    expect(results.length).toBeGreaterThan(0);

    const hasProgrammingChunk = results.some(
      (chunk) => chunk.docId === "programming.md",
    );
    expect(hasProgrammingChunk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Hybrid with RRF fusion
// ---------------------------------------------------------------------------

describe("PipelineRetriever — hybrid with RRF fusion", () => {
  const config: PipelineConfig = {
    name: "hybrid-rrf",
    search: { strategy: "hybrid", fusionMethod: "rrf" },
  };

  let retriever: PipelineRetriever;

  beforeEach(async () => {
    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(testCorpus());
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("returns results without crashing", async () => {
    const results = await retriever.retrieve("dogs loyal companions", 5);

    expect(results.length).toBeGreaterThan(0);
  });

  it("combines rankings from both strategies", async () => {
    const results = await retriever.retrieve("pasta Italian cuisine", 5);

    expect(results.length).toBeGreaterThan(0);
    // Verify the results are valid PositionAwareChunks
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Refinement: threshold filter
// ---------------------------------------------------------------------------

describe("PipelineRetriever — threshold refinement", () => {
  it("high threshold filters most results", async () => {
    const noThresholdConfig: PipelineConfig = {
      name: "no-threshold",
      search: { strategy: "dense" },
    };
    const thresholdConfig: PipelineConfig = {
      name: "threshold-test",
      search: { strategy: "dense" },
      refinement: [{ type: "threshold", minScore: 0.99 }],
    };

    const deps = defaultDeps();
    const noThresholdRetriever = new PipelineRetriever(noThresholdConfig, deps);
    const thresholdRetriever = new PipelineRetriever(thresholdConfig, deps);

    const corpus = testCorpus();
    await noThresholdRetriever.init(corpus);
    await thresholdRetriever.init(corpus);

    const unfilteredResults = await noThresholdRetriever.retrieve("dogs cats", 10);
    const filteredResults = await thresholdRetriever.retrieve("dogs cats", 10);

    expect(filteredResults.length).toBeLessThan(unfilteredResults.length);

    await noThresholdRetriever.cleanup();
    await thresholdRetriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 6. Refinement: rerank
// ---------------------------------------------------------------------------

describe("PipelineRetriever — rerank refinement", () => {
  it("applies mock reranker that reverses chunk order", async () => {
    const config: PipelineConfig = {
      name: "rerank-test",
      search: { strategy: "dense" },
      refinement: [{ type: "rerank" }],
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ reranker: mockReranker }));
    await retriever.init(testCorpus());

    const results = await retriever.retrieve("test query", 5);

    expect(results.length).toBeGreaterThan(0);

    // Retrieve without reranker to get the original order
    const plainConfig: PipelineConfig = {
      name: "plain-test",
      search: { strategy: "dense" },
    };
    const plainRetriever = new PipelineRetriever(plainConfig, defaultDeps());
    await plainRetriever.init(testCorpus());
    const plainResults = await plainRetriever.retrieve("test query", 5);

    // The mock reranker reverses order, so the first result of the reranked
    // pipeline should match the last result of the plain pipeline (when both
    // have the same number of results).
    if (results.length > 1 && plainResults.length > 1) {
      const rerankedFirst = results[0];
      const plainLast = plainResults[plainResults.length - 1];
      expect(rerankedFirst.id).toBe(plainLast.id);
    }

    await retriever.cleanup();
    await plainRetriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 7. Constructor validation
// ---------------------------------------------------------------------------

describe("PipelineRetriever — constructor validation", () => {
  it("throws when refinement includes rerank but no reranker is provided", () => {
    const config: PipelineConfig = {
      name: "bad-rerank",
      refinement: [{ type: "rerank" }],
    };

    expect(() => new PipelineRetriever(config, defaultDeps())).toThrow(
      'PipelineRetriever: refinement includes "rerank" step but no reranker was provided in deps.',
    );
  });

  it("does not throw when rerank step has a reranker", () => {
    const config: PipelineConfig = {
      name: "good-rerank",
      refinement: [{ type: "rerank" }],
    };

    expect(
      () => new PipelineRetriever(config, defaultDeps({ reranker: mockReranker })),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Cleanup
// ---------------------------------------------------------------------------

describe("PipelineRetriever — cleanup", () => {
  it("throws not-initialized error after cleanup", async () => {
    const config: PipelineConfig = { name: "cleanup-test" };
    const retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(testCorpus());

    // Sanity check: retrieve works before cleanup
    const results = await retriever.retrieve("test", 3);
    expect(results.length).toBeGreaterThan(0);

    await retriever.cleanup();

    await expect(retriever.retrieve("test", 3)).rejects.toThrow(
      "PipelineRetriever not initialized. Call init() first.",
    );
  });

  it("can re-init after cleanup", async () => {
    const config: PipelineConfig = { name: "reinit-test" };
    const retriever = new PipelineRetriever(config, defaultDeps());

    await retriever.init(testCorpus());
    await retriever.cleanup();

    // Re-initialize with the same corpus
    await retriever.init(testCorpus());
    const results = await retriever.retrieve("dogs", 3);
    expect(results.length).toBeGreaterThan(0);

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 9. indexConfigHash
// ---------------------------------------------------------------------------

describe("PipelineRetriever — indexConfigHash", () => {
  it("is a valid 64-character hex string (SHA-256)", () => {
    const config: PipelineConfig = { name: "hash-test" };
    const retriever = new PipelineRetriever(config, defaultDeps());

    expect(retriever.indexConfigHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same hash for identical index configs", () => {
    const configA: PipelineConfig = {
      name: "pipeline-a",
      index: { strategy: "plain", chunkSize: 500, chunkOverlap: 100 },
    };
    const configB: PipelineConfig = {
      name: "pipeline-b",
      index: { strategy: "plain", chunkSize: 500, chunkOverlap: 100 },
    };

    const retrieverA = new PipelineRetriever(configA, defaultDeps());
    const retrieverB = new PipelineRetriever(configB, defaultDeps());

    expect(retrieverA.indexConfigHash).toBe(retrieverB.indexConfigHash);
  });

  it("produces different hashes when index config differs", () => {
    const configA: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkSize: 500 },
    };
    const configB: PipelineConfig = {
      name: "test",
      index: { strategy: "plain", chunkSize: 1000 },
    };

    const retrieverA = new PipelineRetriever(configA, defaultDeps());
    const retrieverB = new PipelineRetriever(configB, defaultDeps());

    expect(retrieverA.indexConfigHash).not.toBe(retrieverB.indexConfigHash);
  });
});
