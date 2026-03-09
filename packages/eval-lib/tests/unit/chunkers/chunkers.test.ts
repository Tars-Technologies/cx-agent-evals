import { describe, it, expect, vi } from "vitest";
import { RecursiveCharacterChunker } from "../../../src/chunkers/recursive-character.js";
import {
  isPositionAwareChunker,
  isAsyncPositionAwareChunker,
} from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";
import type { Chunker } from "../../../src/chunkers/chunker.interface.js";

describe("isPositionAwareChunker", () => {
  it("should return true for RecursiveCharacterChunker", () => {
    const chunker = new RecursiveCharacterChunker({ chunkSize: 100, chunkOverlap: 0 });
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should return false for basic chunker", () => {
    const chunker: Chunker = { name: "basic", chunk: (t) => [t] };
    expect(isPositionAwareChunker(chunker)).toBe(false);
  });
});

describe("RecursiveCharacterChunker", () => {
  it("should reject overlap >= chunkSize", () => {
    expect(() => new RecursiveCharacterChunker({ chunkSize: 100, chunkOverlap: 100 })).toThrow();
    expect(() => new RecursiveCharacterChunker({ chunkSize: 100, chunkOverlap: 200 })).toThrow();
  });

  it("should chunk text into pieces no larger than chunkSize", () => {
    const chunker = new RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 0 });
    const text = "A".repeat(200);
    const chunks = chunker.chunk(text);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should return single chunk for small text", () => {
    const chunker = new RecursiveCharacterChunker({ chunkSize: 1000 });
    const chunks = chunker.chunk("short text");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("short text");
  });

  it("should produce valid positions with chunkWithPositions", () => {
    const content = "Hello world.\n\nThis is a test paragraph.\n\nAnother paragraph here with more text.";
    const doc = createDocument({ id: "test.md", content });
    const chunker = new RecursiveCharacterChunker({ chunkSize: 40, chunkOverlap: 0 });
    const chunks = chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should split at paragraph boundaries first", () => {
    const content = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
    const chunker = new RecursiveCharacterChunker({ chunkSize: 25, chunkOverlap: 0 });
    const chunks = chunker.chunk(content);
    // Each paragraph is ~21 chars, fits in 25, so should be separate chunks
    expect(chunks).toContain("First paragraph here.");
    expect(chunks).toContain("Second paragraph here.");
    expect(chunks).toContain("Third paragraph here.");
  });
});

describe("isAsyncPositionAwareChunker", () => {
  it("returns true for chunker with async discriminator", () => {
    const chunker = {
      name: "test-async",
      async: true as const,
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(true);
  });

  it("returns false for sync chunker without async property", () => {
    const chunker = {
      name: "test-sync",
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(false);
  });

  it("returns false for chunker with async=false", () => {
    const chunker = {
      name: "test",
      async: false,
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(false);
  });
});
