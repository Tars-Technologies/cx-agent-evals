import { describe, it, expect } from "vitest";
import { TokenChunker } from "../../../src/chunkers/token.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";
import { getEncoding } from "js-tiktoken";

describe("TokenChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new TokenChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "The quick brown fox jumps over the lazy dog. A second sentence follows here with some additional words for testing purposes.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 10 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should not exceed maxTokens per chunk", () => {
    const content =
      "The quick brown fox jumps over the lazy dog. A second sentence follows here with some additional words.";
    const doc = createDocument({ id: "d1", content });
    const maxTokens = 10;
    const chunker = new TokenChunker({ maxTokens });
    const chunks = chunker.chunkWithPositions(doc);

    const enc = getEncoding("cl100k_base");
    for (const chunk of chunks) {
      const tokenCount = enc.encode(chunk.content).length;
      expect(tokenCount).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("should return single chunk for short text", () => {
    const content = "Hello world.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 256 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world.");
  });

  it("should handle token overlap", () => {
    const content =
      "Word1 Word2 Word3 Word4 Word5 Word6 Word7 Word8 Word9 Word10 Word11 Word12";
    const doc = createDocument({ id: "d1", content });
    const chunker = new TokenChunker({ maxTokens: 6, overlapTokens: 2 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new TokenChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new TokenChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new TokenChunker({ maxTokens: 10 });
    const chunks = chunker.chunk(
      "The quick brown fox jumps over the lazy dog.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should reject overlapTokens >= maxTokens", () => {
    expect(
      () => new TokenChunker({ maxTokens: 10, overlapTokens: 10 }),
    ).toThrow();
    expect(
      () => new TokenChunker({ maxTokens: 10, overlapTokens: 15 }),
    ).toThrow();
  });

  it("should have a descriptive name", () => {
    const chunker = new TokenChunker({ maxTokens: 128 });
    expect(chunker.name).toBe("Token(tokens=128)");
  });
});
