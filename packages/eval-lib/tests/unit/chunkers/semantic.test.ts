import { describe, it, expect, vi } from "vitest";
import { SemanticChunker } from "../../../src/chunkers/semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { Embedder } from "../../../src/embedders/embedder.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeMockEmbedder(embeddings: number[][]): Embedder {
  return {
    name: "mock-embedder",
    dimension: embeddings[0]?.length ?? 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      return texts.map((_, i) => embeddings[i % embeddings.length]!);
    }),
    embedQuery: vi.fn(async () => embeddings[0]!),
  };
}

describe("SemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const embedder = makeMockEmbedder([[1, 0]]);
    const chunker = new SemanticChunker(embedder);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name format", () => {
    const embedder = makeMockEmbedder([[1, 0]]);
    const chunker = new SemanticChunker(embedder, { percentileThreshold: 90 });
    expect(chunker.name).toBe("Semantic(threshold=90)");
  });

  it("uses default threshold of 95 in name", () => {
    const embedder = makeMockEmbedder([[1, 0]]);
    const chunker = new SemanticChunker(embedder);
    expect(chunker.name).toBe("Semantic(threshold=95)");
  });

  it("produces chunks with valid positions", async () => {
    const doc = makeDoc(
      "doc1",
      "The cat sat on the mat. Dogs love to play fetch. The weather is sunny today.",
    );

    const embedder = makeMockEmbedder([
      [1, 0, 0, 0],
      [0.99, 0.1, 0, 0],
      [0.98, 0.2, 0, 0],
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 95 });
    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(doc.content.length);
    }
  });

  it("splits at semantic boundaries (dissimilar consecutive embeddings)", async () => {
    const sentences = [
      "Machine learning is transforming industries.",
      "Deep learning uses neural networks.",
      "The stock market crashed today.",
      "Investors are worried about the economy.",
    ];
    const doc = makeDoc("doc1", sentences.join(" "));

    // First two embeddings are very similar; third is completely different
    const embedder = makeMockEmbedder([
      [1, 0, 0, 0],
      [0.95, 0.1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0.95, 0.1],
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 50 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.content).toContain("Machine learning");
    expect(chunks[chunks.length - 1]!.content).toContain("stock market");
  });

  it("sub-splits oversized chunks with RecursiveCharacterChunker", async () => {
    const longSentence = "A".repeat(500);
    const doc = makeDoc("doc1", longSentence + ". Short sentence here.");

    const embedder = makeMockEmbedder([
      [1, 0],
      [0.99, 0.1],
    ]);

    const chunker = new SemanticChunker(embedder, { maxChunkSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it("returns single chunk for short document", async () => {
    const doc = makeDoc("doc1", "Hello world.");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hello world.");
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(0);
  });

  it("handles whitespace-only document", async () => {
    const doc = makeDoc("doc1", "   \n\t  ");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(0);
  });

  it("calls embedder.embed with all sentence texts", async () => {
    const doc = makeDoc("doc1", "First sentence. Second sentence. Third sentence.");
    const embedder = makeMockEmbedder([
      [1, 0],
      [0.9, 0.1],
      [0.8, 0.2],
    ]);

    const chunker = new SemanticChunker(embedder);
    await chunker.chunkWithPositions(doc);

    expect(embedder.embed).toHaveBeenCalledTimes(1);
    const callArgs = (embedder.embed as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs).toHaveLength(3);
  });

  it("does not call embedder for single-sentence documents", async () => {
    const doc = makeDoc("doc1", "Just one sentence here.");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    await chunker.chunkWithPositions(doc);

    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("preserves all content without gaps", async () => {
    const content =
      "Alpha sentence here. Beta sentence there. Gamma sentence everywhere. Delta at the end.";
    const doc = makeDoc("doc1", content);

    // Make each embedding drastically different to force splits
    const embedder = makeMockEmbedder([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 10 });
    const chunks = await chunker.chunkWithPositions(doc);

    // Verify every character of the original content is in exactly one chunk
    const reconstructed = chunks.map((c) => c.content).join("");
    // Since splits happen at sentence boundaries with spaces, we verify
    // each chunk's content matches its position in the original
    for (const chunk of chunks) {
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }

    // Verify chunks cover the whole document (no gaps)
    const sortedChunks = [...chunks].sort((a, b) => a.start - b.start);
    expect(sortedChunks[0]!.start).toBe(0);
    expect(sortedChunks[sortedChunks.length - 1]!.end).toBe(content.length);
  });

  it("generates unique chunk IDs", async () => {
    const doc = makeDoc(
      "doc1",
      "First topic here. Second topic there. Third topic everywhere.",
    );
    const embedder = makeMockEmbedder([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 10 });
    const chunks = await chunker.chunkWithPositions(doc);

    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("sets empty metadata on each chunk", async () => {
    const doc = makeDoc("doc1", "One sentence. Another sentence.");
    const embedder = makeMockEmbedder([
      [1, 0],
      [0.9, 0.1],
    ]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.metadata).toEqual({});
    }
  });
});
