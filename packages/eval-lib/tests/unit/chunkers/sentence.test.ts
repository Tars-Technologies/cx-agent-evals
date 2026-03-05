import { describe, it, expect } from "vitest";
import { SentenceChunker } from "../../../src/chunkers/sentence.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";

describe("SentenceChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new SentenceChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "First sentence here. Second sentence here. Third sentence here.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should not exceed maxChunkSize", () => {
    const content =
      "Alpha sentence here. Beta sentence here. Gamma sentence here. Delta sentence here. Epsilon sentence here.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should return single chunk for short text", () => {
    const content = "Just one sentence.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Just one sentence.");
  });

  it("should handle overlap sentences", () => {
    const content =
      "First sent. Second sent. Third sent. Fourth sent.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 30, overlapSentences: 1 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new SentenceChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new SentenceChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should handle text without sentence boundaries", () => {
    const content = "no uppercase after period. still going on";
    const doc = createDocument({ id: "d1", content });
    const chunker = new SentenceChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunk(
      "First sentence here. Second sentence here. Third sentence here.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should have a descriptive name", () => {
    const chunker = new SentenceChunker({ maxChunkSize: 500 });
    expect(chunker.name).toBe("Sentence(size=500)");
  });
});
