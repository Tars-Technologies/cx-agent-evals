import { describe, it, expect, vi } from "vitest";
import { LLMSemanticChunker } from "../../../src/chunkers/llm-semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { PipelineLLM } from "../../../src/retrievers/pipeline/llm.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeMockLLM(splitPoints: number[]): PipelineLLM {
  return {
    name: "mock-llm",
    complete: vi.fn(async () =>
      splitPoints.length > 0
        ? `split_after: ${splitPoints.join(", ")}`
        : "split_after: none",
    ),
  };
}

describe("LLMSemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name", () => {
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    expect(chunker.name).toBe("LLMSemantic");
  });

  it("produces chunks with valid positions", async () => {
    const content = "The cat sat on the mat. Dogs play fetch. The sun is warm.";
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([1]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 25, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("splits text based on LLM-identified boundaries", async () => {
    const content = "Topic A content here. Topic B starts now. Topic C is last.";
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([0, 1]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 20, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns single chunk when LLM says no splits", async () => {
    const content = "Short coherent text about one topic.";
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 50, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(content);
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(0);
  });

  it("handles invalid LLM response gracefully", async () => {
    const content = "Some text that needs chunking into pieces.";
    const doc = makeDoc("doc1", content);

    const llm: PipelineLLM = {
      name: "bad-llm",
      complete: vi.fn(async () => "I don't know what to do"),
    };

    const chunker = new LLMSemanticChunker(llm, { segmentSize: 20, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("covers entire document without gaps", async () => {
    const content = "Word ".repeat(30); // 150 chars
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([1, 3]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 25, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(content.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
    }
  });
});
