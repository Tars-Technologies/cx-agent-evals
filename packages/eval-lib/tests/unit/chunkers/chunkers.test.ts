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

describe("overlap duplication bug", () => {
  it("should not produce duplicate chunks with paragraph sizes near chunkSize", () => {
    const chunker = new RecursiveCharacterChunker({
      chunkSize: 400,
      chunkOverlap: 80,
    });

    // Two paragraphs of ~300 chars each, separated by \n\n
    const paraA = "A".repeat(298);
    const paraB = "B".repeat(298);
    const text = paraA + "\n\n" + paraB;

    const chunks = chunker.chunk(text);

    // Should be 2-3 chunks (one per paragraph, maybe one overlap), NOT 4+
    expect(chunks.length).toBeLessThanOrEqual(3);

    // No exact duplicates
    const unique = new Set(chunks);
    expect(unique.size).toBe(chunks.length);
  });

  it("should produce roughly proportional chunk counts for smaller chunkSize", () => {
    const large = new RecursiveCharacterChunker({ chunkSize: 1000, chunkOverlap: 200 });
    const small = new RecursiveCharacterChunker({ chunkSize: 400, chunkOverlap: 80 });

    // Generate a document with many paragraphs of varied sizes
    const paragraphs = Array.from({ length: 50 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)).repeat(150 + (i * 7) % 200)
    );
    const text = paragraphs.join("\n\n");

    const largeChunks = large.chunk(text);
    const smallChunks = small.chunk(text);

    // With 2.5x smaller chunks, expect roughly 2-4x more chunks, not 8x
    const ratio = smallChunks.length / largeChunks.length;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(5);
  });

  it("should produce valid positions with no content loss after overlap fix", () => {
    const chunker = new RecursiveCharacterChunker({
      chunkSize: 400,
      chunkOverlap: 80,
    });
    const content = Array.from({ length: 20 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)).repeat(200 + (i * 13) % 300)
    ).join("\n\n");

    const doc = createDocument({ id: "test-overlap.md", content });
    const chunks = chunker.chunkWithPositions(doc);

    // Every chunk's content must match its span in the source
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(content.length);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }

    // All source content is covered (union of all chunk spans covers full text)
    const covered = new Set<number>();
    for (const chunk of chunks) {
      for (let i = chunk.start; i < chunk.end; i++) covered.add(i);
    }
    // Non-whitespace chars should all be covered
    for (let i = 0; i < content.length; i++) {
      if (content[i].trim()) {
        expect(covered.has(i)).toBe(true);
      }
    }
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
