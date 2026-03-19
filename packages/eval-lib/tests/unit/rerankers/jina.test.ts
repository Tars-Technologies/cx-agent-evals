import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaReranker } from "../../../src/rerankers/jina.js";
import type { PositionAwareChunk } from "../../../src/types/index.js";

const makeChunk = (id: string, content: string): PositionAwareChunk => ({
  id: id as any,
  content,
  docId: "doc1" as any,
  start: 0,
  end: content.length,
  metadata: {},
});

describe("JinaReranker", () => {
  const mockClient = {
    rerank: vi.fn(),
  };

  beforeEach(() => {
    mockClient.rerank.mockReset();
  });

  describe("constructor", () => {
    it("should use default model when none specified", () => {
      const reranker = new JinaReranker({ client: mockClient });
      expect(reranker.name).toBe("Jina(jina-reranker-v2-base-multilingual)");
    });

    it("should use specified model", () => {
      const reranker = new JinaReranker({
        client: mockClient,
        model: "jina-reranker-v1-base-en",
      });
      expect(reranker.name).toBe("Jina(jina-reranker-v1-base-en)");
    });
  });

  describe("rerank()", () => {
    it("should return empty array for empty input", async () => {
      const reranker = new JinaReranker({ client: mockClient });
      const result = await reranker.rerank("query", []);
      expect(result).toEqual([]);
      expect(mockClient.rerank).not.toHaveBeenCalled();
    });

    it("should map response indices back to original chunks", async () => {
      const chunks = [
        makeChunk("c1", "first"),
        makeChunk("c2", "second"),
        makeChunk("c3", "third"),
      ];
      mockClient.rerank.mockResolvedValue({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 },
        ],
      });

      const reranker = new JinaReranker({ client: mockClient });
      const result = await reranker.rerank("query", chunks, 2);

      expect(result).toEqual([chunks[2], chunks[0]]);
      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "jina-reranker-v2-base-multilingual",
          query: "query",
          documents: ["first", "second", "third"],
          top_n: 2,
        }),
      );
    });

    it("should default topK to chunks.length when omitted", async () => {
      const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second")];
      mockClient.rerank.mockResolvedValue({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 },
        ],
      });

      const reranker = new JinaReranker({ client: mockClient });
      await reranker.rerank("query", chunks);

      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({ top_n: 2 }),
      );
    });

    it("should preserve chunk metadata through reranking", async () => {
      const chunk: PositionAwareChunk = {
        id: "c1" as any,
        content: "hello world",
        docId: "doc42" as any,
        start: 10,
        end: 21,
        metadata: { source: "test" },
      };
      mockClient.rerank.mockResolvedValue({
        results: [{ index: 0, relevance_score: 0.95 }],
      });

      const reranker = new JinaReranker({ client: mockClient });
      const result = await reranker.rerank("query", [chunk], 1);

      expect(result[0]).toBe(chunk);
      expect(result[0].docId).toBe("doc42");
      expect(result[0].start).toBe(10);
      expect(result[0].end).toBe(21);
      expect(result[0].metadata).toEqual({ source: "test" });
    });

    it("should pass custom model to client", async () => {
      const chunks = [makeChunk("c1", "text")];
      mockClient.rerank.mockResolvedValue({
        results: [{ index: 0, relevance_score: 0.8 }],
      });

      const reranker = new JinaReranker({
        client: mockClient,
        model: "jina-reranker-v1-base-en",
      });
      await reranker.rerank("query", chunks);

      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({ model: "jina-reranker-v1-base-en" }),
      );
    });
  });
});
