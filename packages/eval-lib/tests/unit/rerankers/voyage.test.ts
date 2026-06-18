import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VoyageReranker } from "../../../src/rerankers/voyage.js"
import type { PositionAwareChunk } from "../../../src/types/index.js"

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  } as unknown as Response
}

const makeChunk = (id: string, content: string): PositionAwareChunk => ({
  id: id as any,
  content,
  docId: "doc1" as any,
  start: 0,
  end: content.length,
  metadata: {}
})

describe("VoyageReranker", () => {
  const mockClient = {
    rerank: vi.fn()
  }

  beforeEach(() => {
    mockClient.rerank.mockReset()
  })

  describe("constructor", () => {
    it("should use default model when none specified", () => {
      const reranker = new VoyageReranker({ client: mockClient })
      expect(reranker.name).toBe("Voyage(rerank-2.5)")
    })

    it("should use specified model", () => {
      const reranker = new VoyageReranker({
        client: mockClient,
        model: "rerank-2"
      })
      expect(reranker.name).toBe("Voyage(rerank-2)")
    })
  })

  describe("rerank()", () => {
    it("should return empty array for empty input", async () => {
      const reranker = new VoyageReranker({ client: mockClient })
      const result = await reranker.rerank("query", [])
      expect(result).toEqual([])
      expect(mockClient.rerank).not.toHaveBeenCalled()
    })

    it("should map response data indices back to original chunks", async () => {
      const chunks = [
        makeChunk("c1", "first"),
        makeChunk("c2", "second"),
        makeChunk("c3", "third")
      ]
      mockClient.rerank.mockResolvedValue({
        data: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 }
        ]
      })

      const reranker = new VoyageReranker({ client: mockClient })
      const result = await reranker.rerank("query", chunks, 2)

      expect(result).toEqual([chunks[2], chunks[0]])
      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "rerank-2.5",
          query: "query",
          documents: ["first", "second", "third"],
          top_k: 2
        })
      )
    })

    it("should default topK to chunks.length when omitted", async () => {
      const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second")]
      mockClient.rerank.mockResolvedValue({
        data: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 }
        ]
      })

      const reranker = new VoyageReranker({ client: mockClient })
      await reranker.rerank("query", chunks)

      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({ top_k: 2 })
      )
    })

    it("should preserve chunk metadata through reranking", async () => {
      const chunk: PositionAwareChunk = {
        id: "c1" as any,
        content: "hello world",
        docId: "doc42" as any,
        start: 10,
        end: 21,
        metadata: { source: "test" }
      }
      mockClient.rerank.mockResolvedValue({
        data: [{ index: 0, relevance_score: 0.95 }]
      })

      const reranker = new VoyageReranker({ client: mockClient })
      const result = await reranker.rerank("query", [chunk], 1)

      expect(result[0]).toBe(chunk)
      expect(result[0].docId).toBe("doc42")
      expect(result[0].start).toBe(10)
      expect(result[0].end).toBe(21)
      expect(result[0].metadata).toEqual({ source: "test" })
    })

    it("should pass custom model to client", async () => {
      const chunks = [makeChunk("c1", "text")]
      mockClient.rerank.mockResolvedValue({
        data: [{ index: 0, relevance_score: 0.8 }]
      })

      const reranker = new VoyageReranker({
        client: mockClient,
        model: "rerank-2"
      })
      await reranker.rerank("query", chunks)

      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({ model: "rerank-2" })
      )
    })

    it("drops out-of-range indices instead of emitting undefined", async () => {
      const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second")]
      mockClient.rerank.mockResolvedValue({
        data: [
          { index: 9, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 }
        ]
      })
      const reranker = new VoyageReranker({ client: mockClient })
      const result = await reranker.rerank("query", chunks, 2)
      expect(result).toEqual([chunks[0]])
    })
  })

  describe("create() HTTP wire contract", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch")
    })
    afterEach(() => vi.restoreAllMocks())

    it("POSTs to the Voyage rerank endpoint with bearer auth + top_k body", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ data: [{ index: 0, relevance_score: 0.9 }] })
      )
      const reranker = await VoyageReranker.create({ apiKey: "test-key" })
      const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second")]
      const result = await reranker.rerank("q", chunks, 1)

      expect(result).toEqual([chunks[0]])
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.voyageai.com/v1/rerank")
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key"
        }
      })
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        model: "rerank-2.5",
        query: "q",
        documents: ["first", "second"],
        top_k: 1
      })
    })

    it("throws a clear error when no API key is available", async () => {
      const prev = process.env.VOYAGE_API_KEY
      delete process.env.VOYAGE_API_KEY
      await expect(VoyageReranker.create()).rejects.toThrow(/Voyage API key/)
      if (prev !== undefined) process.env.VOYAGE_API_KEY = prev
    })
  })
})
