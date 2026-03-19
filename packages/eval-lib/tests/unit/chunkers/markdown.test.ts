import { describe, it, expect } from "vitest";
import { MarkdownChunker } from "../../../src/chunkers/markdown.js";
import { isPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { createDocument } from "../../../src/types/documents.js";

describe("MarkdownChunker", () => {
  it("should satisfy isPositionAwareChunker", () => {
    const chunker = new MarkdownChunker();
    expect(isPositionAwareChunker(chunker)).toBe(true);
  });

  it("should produce valid positions matching source text", () => {
    const content =
      "# Title\n\nSome intro text.\n\n## Section 1\n\nContent of section one.\n\n## Section 2\n\nContent of section two.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should split at header boundaries", () => {
    const content =
      "# Header 1\n\nFirst section content.\n\n# Header 2\n\nSecond section content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain("Header 1");
    expect(chunks[1].content).toContain("Header 2");
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should merge small sections when enabled", () => {
    const content = "# A\n\nSmall.\n\n# B\n\nSmall.\n\n# C\n\nSmall.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 200,
      mergeSmallSections: true,
    });
    const chunks = chunker.chunkWithPositions(doc);

    // All sections together are well under 200 chars, should merge into 1
    expect(chunks).toHaveLength(1);
    expect(content.slice(chunks[0].start, chunks[0].end)).toBe(
      chunks[0].content,
    );
  });

  it("should not merge sections that exceed maxChunkSize", () => {
    const longContent = "Some detailed content here. ".repeat(5);
    const content = `# Section A\n\n${longContent}\n\n# Section B\n\n${longContent}`;
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 100,
      mergeSmallSections: true,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should sub-split large sections", () => {
    const longContent = "Detailed content. ".repeat(100);
    const content = `# Section\n\n${longContent.trim()}`;
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 200 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should handle text with no headers", () => {
    const content = "Just plain text without any markdown headers.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({ maxChunkSize: 1000 });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
  });

  it("should return empty array for empty text", () => {
    const doc = createDocument({ id: "d1", content: "" });
    const chunker = new MarkdownChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should return empty array for whitespace-only text", () => {
    const doc = createDocument({ id: "d1", content: "   \n\n  " });
    const chunker = new MarkdownChunker();
    expect(chunker.chunkWithPositions(doc)).toEqual([]);
  });

  it("should respect headerLevels option", () => {
    const content =
      "# H1\n\nH1 content.\n\n## H2\n\nH2 content.\n\n### H3\n\nH3 content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      headerLevels: [1],
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    // Only H1 is a split point, so everything is one section
    expect(chunks).toHaveLength(1);
    expect(content.slice(chunks[0].start, chunks[0].end)).toBe(
      chunks[0].content,
    );
  });

  it("should handle content before first header", () => {
    const content = "Preamble text.\n\n# Header\n\nSection content.";
    const doc = createDocument({ id: "d1", content });
    const chunker = new MarkdownChunker({
      maxChunkSize: 1000,
      mergeSmallSections: false,
    });
    const chunks = chunker.chunkWithPositions(doc);

    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toBe("Preamble text.");
    expect(chunks[1].content).toContain("Header");
    for (const chunk of chunks) {
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should implement chunk() for Chunker interface", () => {
    const chunker = new MarkdownChunker({ maxChunkSize: 100 });
    const chunks = chunker.chunk(
      "# Title\n\nContent here.\n\n## Section\n\nMore content.",
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(typeof c).toBe("string");
    }
  });

  it("should have a descriptive name", () => {
    const chunker = new MarkdownChunker({ maxChunkSize: 500 });
    expect(chunker.name).toBe("Markdown(size=500)");
  });
});
