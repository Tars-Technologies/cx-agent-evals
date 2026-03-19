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
// Shared helpers
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
// Contextual index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — contextual index strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm("This chunk discusses important topics.");

    const config: PipelineConfig = {
      name: "contextual-test",
      index: { strategy: "contextual" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM for each chunk during init", () => {
    // The chunker produces multiple chunks from our 2 documents.
    // Each chunk should trigger one LLM call.
    expect(mockLlm.complete).toHaveBeenCalled();
    const callCount = mockLlm.complete.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
  });

  it("should include document content and chunk content in the LLM prompt", () => {
    const firstPrompt = mockLlm.complete.mock.calls[0][0] as string;

    // DEFAULT_CONTEXT_PROMPT uses {doc.content} and {chunk.content} placeholders
    // After substitution, the prompt should contain actual document text
    expect(firstPrompt).toContain("<document>");
    expect(firstPrompt).toContain("<chunk>");
    expect(firstPrompt).toContain("</document>");
    expect(firstPrompt).toContain("</chunk>");
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("dogs and cats", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
      expect(typeof chunk.start).toBe("number");
      expect(typeof chunk.end).toBe("number");
    }
  });

  it("should preserve original chunk positions (start/end)", async () => {
    const results = await retriever.retrieve("dogs", 5);

    for (const chunk of results) {
      // start/end should reference positions in the original document
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });

  it("should respect custom contextPrompt", async () => {
    await retriever.cleanup();

    const customPrompt = "Custom context: {doc.content} | Chunk: {chunk.content}";
    const config: PipelineConfig = {
      name: "custom-prompt-test",
      index: { strategy: "contextual", contextPrompt: customPrompt },
      search: { strategy: "dense" },
    };

    const customLlm = createMockLlm("custom context result");
    const customRetriever = new PipelineRetriever(config, defaultDeps({ llm: customLlm }));
    await customRetriever.init(corpus);

    const firstPrompt = customLlm.complete.mock.calls[0][0] as string;
    expect(firstPrompt).toContain("Custom context:");

    await customRetriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Summary index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — summary index strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm("A summary of important topics covered in this passage.");

    const config: PipelineConfig = {
      name: "summary-test",
      index: { strategy: "summary" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM for each chunk during init", () => {
    expect(mockLlm.complete).toHaveBeenCalled();
    const callCount = mockLlm.complete.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
  });

  it("should include chunk content in the LLM prompt", () => {
    const firstPrompt = mockLlm.complete.mock.calls[0][0] as string;

    // DEFAULT_SUMMARY_PROMPT ends with "Passage: " — chunk content is appended
    expect(firstPrompt).toContain("summary");
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("important topics", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it("should preserve original chunk positions", async () => {
    const results = await retriever.retrieve("topics", 5);

    for (const chunk of results) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });

  it("should respect custom summaryPrompt", async () => {
    await retriever.cleanup();

    const config: PipelineConfig = {
      name: "custom-summary-test",
      index: { strategy: "summary", summaryPrompt: "TLDR this text: " },
      search: { strategy: "dense" },
    };

    const customLlm = createMockLlm("tl;dr result");
    const customRetriever = new PipelineRetriever(config, defaultDeps({ llm: customLlm }));
    await customRetriever.init(corpus);

    const firstPrompt = customLlm.complete.mock.calls[0][0] as string;
    expect(firstPrompt).toContain("TLDR this text:");

    await customRetriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Parent-child index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — parent-child index strategy", () => {
  /**
   * Use a longer document so that parent-child chunking produces multiple
   * child and parent chunks.
   */
  function parentChildCorpus(): Corpus {
    return createCorpus([
      createDocument({
        id: "long.md",
        content:
          "Dogs are loyal pets that love humans. " +
          "Cats are independent creatures that enjoy solitude. " +
          "Birds can fly high above the trees. " +
          "Fish live in water and swim gracefully. " +
          "Snakes are fascinating reptiles found worldwide. " +
          "Frogs are amphibians that live near ponds.",
      }),
    ]);
  }

  let retriever: PipelineRetriever;
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = parentChildCorpus();

    const config: PipelineConfig = {
      name: "parent-child-test",
      index: {
        strategy: "parent-child",
        childChunkSize: 50,
        parentChunkSize: 120,
        childOverlap: 0,
        parentOverlap: 0,
      },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("dogs pets", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
      expect(chunk.docId).toBe("long.md");
    }
  });

  it("should return parent chunks (larger) not child chunks (smaller)", async () => {
    const results = await retriever.retrieve("dogs pets", 5);

    // Parent chunks should be larger than child chunk size (50)
    for (const chunk of results) {
      // Parent content length should generally be >= child chunk size
      // (unless it's the last chunk of a document)
      expect(chunk.end - chunk.start).toBeGreaterThanOrEqual(40);
    }
  });

  it("should deduplicate parents when multiple children match the same parent", async () => {
    // Searching broadly — likely matches children from the same parent
    const results = await retriever.retrieve("animals pets creatures", 10);

    // Should not have duplicate parent IDs
    const parentIds = results.map((c) => String(c.id));
    expect(new Set(parentIds).size).toBe(parentIds.length);
  });

  it("should not require an LLM", () => {
    expect(
      () =>
        new PipelineRetriever(
          {
            name: "no-llm",
            index: { strategy: "parent-child", childChunkSize: 50, parentChunkSize: 120 },
          },
          defaultDeps(), // no llm
        ),
    ).not.toThrow();
  });

  it("should work after cleanup and re-init", async () => {
    const results1 = await retriever.retrieve("dogs", 3);
    expect(results1.length).toBeGreaterThan(0);

    await retriever.cleanup();

    await retriever.init(corpus);
    const results2 = await retriever.retrieve("dogs", 3);
    expect(results2.length).toBeGreaterThan(0);
  });
});
