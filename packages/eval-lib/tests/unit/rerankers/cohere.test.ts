import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import { CohereReranker } from "../../../src/rerankers/cohere.js"
import type { PositionAwareChunk } from "../../../src/types/index.js"

const makeChunk = (id: string, content: string): PositionAwareChunk => ({
  id: id as any,
  content,
  docId: "doc1" as any,
  start: 0,
  end: content.length,
  metadata: {}
})

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  } as unknown as Response
}

describe("CohereReranker", () => {
  const mockClient = { rerank: vi.fn() }
  beforeEach(() => mockClient.rerank.mockReset())

  describe("rerank()", () => {
    it("returns empty array for empty input", async () => {
      const reranker = new CohereReranker(mockClient, "rerank-english-v3.0")
      expect(await reranker.rerank("q", [])).toEqual([])
      expect(mockClient.rerank).not.toHaveBeenCalled()
    })

    it("maps result indices back to chunks and caps to topK", async () => {
      const chunks = [
        makeChunk("c1", "first"),
        makeChunk("c2", "second"),
        makeChunk("c3", "third")
      ]
      mockClient.rerank.mockResolvedValue({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 }
        ]
      })
      const reranker = new CohereReranker(mockClient, "rerank-english-v3.0")
      const result = await reranker.rerank("query", chunks, 2)

      expect(result).toEqual([chunks[2], chunks[0]])
      expect(mockClient.rerank).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "rerank-english-v3.0",
          query: "query",
          documents: ["first", "second", "third"],
          top_n: 2
        })
      )
    })

    it("drops out-of-range indices", async () => {
      const chunks = [makeChunk("c1", "first")]
      mockClient.rerank.mockResolvedValue({
        results: [{ index: 9, relevance_score: 0.9 }]
      })
      const reranker = new CohereReranker(mockClient, "rerank-english-v3.0")
      expect(await reranker.rerank("query", chunks, 1)).toEqual([])
    })
  })

  describe("create() HTTP wire contract", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch")
    })
    afterEach(() => vi.restoreAllMocks())

    it("POSTs to the Cohere v2 rerank endpoint with snake_case body + bearer auth", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ results: [{ index: 0, relevance_score: 0.8 }] })
      )
      const reranker = await CohereReranker.create({ apiKey: "test-key" })
      const result = await reranker.rerank("query", [makeChunk("c1", "hello")], 1)

      expect(result.map((c) => c.content)).toEqual(["hello"])
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.cohere.com/v2/rerank")
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key"
        }
      })
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        model: "rerank-english-v3.0",
        query: "query",
        documents: ["hello"],
        top_n: 1
      })
    })

    it("throws a clear error when no API key is available", async () => {
      const prev = process.env.COHERE_API_KEY
      process.env.COHERE_API_KEY = ""
      await expect(CohereReranker.create()).rejects.toThrow(/Cohere API key/)
      if (prev === undefined) delete process.env.COHERE_API_KEY
      else process.env.COHERE_API_KEY = prev
    })
  })
})
