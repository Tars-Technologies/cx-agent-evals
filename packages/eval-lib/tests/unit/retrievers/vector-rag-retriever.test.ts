import { describe, it, expect, vi, beforeEach } from "vitest";
import { VectorRAGRetriever } from "../../../src/retrievers/vector-rag-retriever.js";
import type { Corpus, PositionAwareChunk } from "../../../src/types/index.js";
import type { PositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import type { Embedder } from "../../../src/embedders/embedder.interface.js";
import type { VectorStore } from "../../../src/vector-stores/vector-store.interface.js";
import type { Reranker } from "../../../src/rerankers/reranker.interface.js";
import { DocumentId, PositionAwareChunkId } from "../../../src/types/primitives.js";

describe("VectorRAGRetriever", () => {
  let mockChunker: PositionAwareChunker;
  let mockEmbedder: Embedder;
  let mockVectorStore: VectorStore;
  let mockReranker: Reranker;
  let corpus: Corpus;

  beforeEach(() => {
    mockChunker = {
      name: "mock-chunker",
      chunkWithPositions: vi.fn().mockReturnValue([
        { id: PositionAwareChunkId("pa_1"), content: "chunk1", docId: DocumentId("doc1"), start: 0, end: 6, metadata: {} },
        { id: PositionAwareChunkId("pa_2"), content: "chunk2", docId: DocumentId("doc1"), start: 7, end: 13, metadata: {} },
      ] as PositionAwareChunk[]),
    };

    mockEmbedder = {
      name: "mock-embedder",
      dimension: 3,
      embed: vi.fn().mockResolvedValue([[1, 0, 0], [0, 1, 0]]),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
    };

    mockVectorStore = {
      name: "mock-store",
      add: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        { id: PositionAwareChunkId("pa_1"), content: "chunk1", docId: DocumentId("doc1"), start: 0, end: 6, metadata: {} },
      ] as PositionAwareChunk[]),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    mockReranker = {
      name: "mock-reranker",
      rerank: vi.fn().mockImplementation((_, chunks) => Promise.resolve(chunks)),
    };

    corpus = {
      id: "test-corpus",
      documents: [
        { id: DocumentId("doc1"), content: "chunk1 chunk2", metadata: {} },
      ],
    };
  });

  describe("init", () => {
    it("should chunk corpus and add to vector store", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await retriever.init(corpus);

      expect(mockChunker.chunkWithPositions).toHaveBeenCalledWith(corpus.documents[0]);
      expect(mockEmbedder.embed).toHaveBeenCalledWith(["chunk1", "chunk2"]);
      expect(mockVectorStore.add).toHaveBeenCalled();
    });

    it("should batch embeddings according to batchSize", async () => {
      const largeChunker: PositionAwareChunker = {
        name: "large-chunker",
        chunkWithPositions: vi.fn().mockReturnValue([
          { id: PositionAwareChunkId("pa_1"), content: "c1", docId: DocumentId("doc1"), start: 0, end: 2, metadata: {} },
          { id: PositionAwareChunkId("pa_2"), content: "c2", docId: DocumentId("doc1"), start: 3, end: 5, metadata: {} },
          { id: PositionAwareChunkId("pa_3"), content: "c3", docId: DocumentId("doc1"), start: 6, end: 8, metadata: {} },
          { id: PositionAwareChunkId("pa_4"), content: "c4", docId: DocumentId("doc1"), start: 9, end: 11, metadata: {} },
          { id: PositionAwareChunkId("pa_5"), content: "c5", docId: DocumentId("doc1"), start: 12, end: 14, metadata: {} },
        ] as PositionAwareChunk[]),
      };

      const retriever = new VectorRAGRetriever({
        chunker: largeChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
        batchSize: 2,
      });

      await retriever.init(corpus);

      // 5 chunks with batchSize 2 = 3 batches
      expect(mockEmbedder.embed).toHaveBeenCalledTimes(3);
    });
  });

  describe("retrieve", () => {
    it("should throw if not initialized", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await expect(retriever.retrieve("query", 5)).rejects.toThrow("not initialized");
    });

    it("should embed query and search vector store", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await retriever.init(corpus);
      const results = await retriever.retrieve("test query", 5);

      expect(mockEmbedder.embedQuery).toHaveBeenCalledWith("test query");
      expect(mockVectorStore.search).toHaveBeenCalledWith([1, 0, 0], 5);
      expect(results).toHaveLength(1);
    });

    it("should apply reranker when provided", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
        reranker: mockReranker,
      });

      await retriever.init(corpus);
      await retriever.retrieve("test query", 3);

      expect(mockReranker.rerank).toHaveBeenCalledWith(
        "test query",
        expect.any(Array),
        3
      );
    });

    it("should not apply reranker when not provided", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await retriever.init(corpus);
      await retriever.retrieve("test query", 5);

      expect(mockReranker.rerank).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("should clear vector store", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await retriever.init(corpus);
      await retriever.cleanup();

      expect(mockVectorStore.clear).toHaveBeenCalled();
    });

    it("should allow re-initialization after cleanup", async () => {
      const retriever = new VectorRAGRetriever({
        chunker: mockChunker,
        embedder: mockEmbedder,
        vectorStore: mockVectorStore,
      });

      await retriever.init(corpus);
      await retriever.cleanup();

      // Should throw because cleanup resets initialization state
      await expect(retriever.retrieve("query", 5)).rejects.toThrow("not initialized");

      // Re-initialize should work
      await retriever.init(corpus);
      const results = await retriever.retrieve("query", 5);
      expect(results).toBeDefined();
    });
  });
});
