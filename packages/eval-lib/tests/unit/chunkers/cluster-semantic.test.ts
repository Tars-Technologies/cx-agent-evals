import { describe, it, expect, vi } from "vitest";
import { ClusterSemanticChunker } from "../../../src/chunkers/cluster-semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { Embedder } from "../../../src/embedders/embedder.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeMockEmbedder(): Embedder {
  let callCount = 0;
  return {
    name: "mock-embedder",
    dimension: 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      callCount++;
      return texts.map((_, i) => {
        const angle = (i / texts.length) * Math.PI;
        return [Math.cos(angle), Math.sin(angle), 0, 0];
      });
    }),
    embedQuery: vi.fn(async () => [1, 0, 0, 0]),
  };
}

function makeClusterEmbedder(embeddings: number[][]): Embedder {
  return {
    name: "mock-embedder",
    dimension: embeddings[0]?.length ?? 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      return texts.map((_, i) => embeddings[i % embeddings.length]!);
    }),
    embedQuery: vi.fn(async () => embeddings[0]!),
  };
}

describe("ClusterSemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name format", () => {
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { maxChunkSize: 500 });
    expect(chunker.name).toBe("ClusterSemantic(size=500)");
  });

  it("produces chunks with valid positions", async () => {
    const content = "Hello world. ".repeat(20); // ~260 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 100,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(doc.content.length);
    }
  });

  it("covers entire document without gaps", async () => {
    const content = "Word ".repeat(100); // 500 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 150,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(content.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
    }
  });

  it("respects maxChunkSize constraint", async () => {
    const content = "Testing chunker behavior. ".repeat(30); // ~780 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 200,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(0);
  });

  it("returns single chunk for very short document", async () => {
    const doc = makeDoc("doc1", "Hi.");
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { maxChunkSize: 400 });
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hi.");
  });

  it("calls embedder.embed once with all segments", async () => {
    const content = "Word ".repeat(50); // 250 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { segmentSize: 30 });

    await chunker.chunkWithPositions(doc);

    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });
});
