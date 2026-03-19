import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PipelineRetriever } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineRetrieverDeps } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineConfig } from "../../../../src/retrievers/pipeline/config.js";
import type { PipelineLLM } from "../../../../src/retrievers/pipeline/llm.interface.js";
import type { Corpus } from "../../../../src/types/index.js";
import { createCorpus, createDocument } from "../../../../src/types/documents.js";
import { RecursiveCharacterChunker } from "../../../../src/chunkers/recursive-character.js";
import { mockEmbedder } from "../../../fixtures.js";

// ---------------------------------------------------------------------------
// Shared test helpers
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

function createMockLlm(
  response: string,
): PipelineLLM & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: "MockLLM",
    complete: vi.fn().mockResolvedValue(response),
  };
}

function defaultDeps(
  overrides?: Partial<PipelineRetrieverDeps>,
): PipelineRetrieverDeps {
  return {
    chunker: new RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 10 }),
    embedder: mockEmbedder(128),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// HyDE strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — HyDE query strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm(
      "Dogs are wonderful pets that have been companions to humans for thousands of years.",
    );

    const config: PipelineConfig = {
      name: "hyde-test",
      query: { strategy: "hyde" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM once with the HyDE prompt + query", async () => {
    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    const prompt = mockLlm.complete.mock.calls[0][0] as string;
    expect(prompt).toContain("What are popular pets?");
    expect(prompt).toContain("passage");
  });

  it("should return valid PositionAwareChunks", async () => {
    const results = await retriever.retrieve("What are popular pets?", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const chunk of results) {
      expect(chunk.id).toBeDefined();
      expect(chunk.content).toBeDefined();
      expect(chunk.start).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("PipelineRetriever — HyDE with multiple hypothetical docs", () => {
  it("should call LLM n times and fuse results", async () => {
    const mockLlm = createMockLlm("Hypothetical doc about pets.");

    const config: PipelineConfig = {
      name: "hyde-multi-test",
      query: { strategy: "hyde", numHypotheticalDocs: 3 },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(3);
    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Multi-query strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — multi-query strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockLlm = createMockLlm(
      "What pets are common\nWhich animals do people keep\nPopular household animals",
    );

    const config: PipelineConfig = {
      name: "multi-query-test",
      query: { strategy: "multi-query", numQueries: 3 },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm }),
    );
    await retriever.init(testCorpus());
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM once to generate query variants", async () => {
    await retriever.retrieve("What are popular pets?", 3);
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  it("should return valid fused results", async () => {
    const results = await retriever.retrieve("What are popular pets?", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should include the query count in the prompt", async () => {
    await retriever.retrieve("What are popular pets?", 3);

    const prompt = mockLlm.complete.mock.calls[0][0] as string;
    expect(prompt).toContain("3");
    expect(prompt).toContain("What are popular pets?");
  });
});

// ---------------------------------------------------------------------------
// Step-back strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — step-back strategy", () => {
  it("should search with both original and abstract query when includeOriginal=true", async () => {
    const mockLlm = createMockLlm(
      "What is the relationship between humans and domesticated animals?",
    );
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "step-back-test",
      query: { strategy: "step-back", includeOriginal: true },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm, embedder }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    // Should embed both the original query and the step-back query
    expect(embedQuerySpy).toHaveBeenCalledTimes(2);
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);

    await retriever.cleanup();
  });

  it("should only search with abstract query when includeOriginal=false", async () => {
    const mockLlm = createMockLlm(
      "What is the relationship between humans and domesticated animals?",
    );
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "step-back-no-orig",
      query: { strategy: "step-back", includeOriginal: false },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm, embedder }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    // Only the abstract query is searched
    expect(embedQuerySpy).toHaveBeenCalledTimes(1);

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Rewrite strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — rewrite strategy", () => {
  it("should call LLM once and search with rewritten query", async () => {
    const mockLlm = createMockLlm("common household pets dogs cats");
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "rewrite-test",
      query: { strategy: "rewrite" },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm, embedder }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("whats popular pets??", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    // Search should use the rewritten query, not the original
    expect(embedQuerySpy).toHaveBeenCalledTimes(1);
    expect(embedQuerySpy).toHaveBeenCalledWith("common household pets dogs cats");

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Identity strategy (regression)
// ---------------------------------------------------------------------------

describe("PipelineRetriever — identity query (regression)", () => {
  it("should NOT call LLM for identity strategy", async () => {
    const mockLlm = createMockLlm("should not be called");

    const config: PipelineConfig = {
      name: "identity-test",
      query: { strategy: "identity" },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).not.toHaveBeenCalled();

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Refinement uses original query, not processed query
// ---------------------------------------------------------------------------

describe("PipelineRetriever — refinement with query strategies", () => {
  it("should pass original query to reranker, not the rewritten query", async () => {
    const mockLlm = createMockLlm("rewritten query text");
    const mockReranker = {
      name: "MockReranker",
      rerank: vi
        .fn()
        .mockImplementation(
          async (_q: string, chunks: any[]) => chunks,
        ),
    };

    const config: PipelineConfig = {
      name: "rewrite-rerank-test",
      query: { strategy: "rewrite" },
      search: { strategy: "dense" },
      refinement: [{ type: "rerank" }],
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm, reranker: mockReranker }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("original user question", 3);

    // Reranker should receive the ORIGINAL query, not the rewritten one
    expect(mockReranker.rerank.mock.calls[0][0]).toBe(
      "original user question",
    );

    await retriever.cleanup();
  });
});
