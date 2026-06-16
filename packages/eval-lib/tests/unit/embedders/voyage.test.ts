import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VoyageEmbedder } from "../../../src/embedders/voyage.js"

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  } as unknown as Response
}

describe("VoyageEmbedder", () => {
  const mockClient = {
    embed: vi.fn()
  }

  beforeEach(() => {
    mockClient.embed.mockReset()
    mockClient.embed.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }]
    })
  })

  describe("constructor", () => {
    it("should use default model when none specified", () => {
      const embedder = new VoyageEmbedder({ client: mockClient })
      expect(embedder.name).toBe("Voyage(voyage-3.5)")
      expect(embedder.dimension).toBe(1024)
    })

    it("should use specified model", () => {
      const embedder = new VoyageEmbedder({
        client: mockClient,
        model: "voyage-3.5-lite"
      })
      expect(embedder.name).toBe("Voyage(voyage-3.5-lite)")
      expect(embedder.dimension).toBe(512)
    })

    it("should set correct dimensions for voyage-3", () => {
      const embedder = new VoyageEmbedder({
        client: mockClient,
        model: "voyage-3"
      })
      expect(embedder.dimension).toBe(1024)
    })

    it("should set correct dimensions for voyage-code-3", () => {
      const embedder = new VoyageEmbedder({
        client: mockClient,
        model: "voyage-code-3"
      })
      expect(embedder.dimension).toBe(1024)
    })

    it("should fall back to 1024 dimensions for unknown model", () => {
      const embedder = new VoyageEmbedder({
        client: mockClient,
        model: "voyage-future-v4"
      })
      expect(embedder.name).toBe("Voyage(voyage-future-v4)")
      expect(embedder.dimension).toBe(1024)
    })
  })

  describe("embed()", () => {
    it("should call client.embed with input_type document", async () => {
      const embedder = new VoyageEmbedder({
        client: mockClient,
        model: "voyage-3.5"
      })
      await embedder.embed(["hello world"])

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "voyage-3.5",
        input: ["hello world"],
        input_type: "document"
      })
    })

    it("should return embeddings from response data", async () => {
      mockClient.embed.mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 }
        ]
      })

      const embedder = new VoyageEmbedder({ client: mockClient })
      const result = await embedder.embed(["text1", "text2"])

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4]
      ])
    })

    it("should spread readonly texts array", async () => {
      mockClient.embed.mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 }
        ]
      })
      const embedder = new VoyageEmbedder({ client: mockClient })
      const texts: readonly string[] = ["a", "b"]
      await embedder.embed(texts)

      expect(mockClient.embed).toHaveBeenCalledWith(
        expect.objectContaining({ input: ["a", "b"] })
      )
    })

    it("reorders embeddings by their API index", async () => {
      mockClient.embed.mockResolvedValue({
        data: [
          { embedding: [0.3, 0.4], index: 1 },
          { embedding: [0.1, 0.2], index: 0 }
        ]
      })
      const embedder = new VoyageEmbedder({ client: mockClient })
      const result = await embedder.embed(["first", "second"])
      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4]
      ])
    })

    it("throws when the returned count does not match the input", async () => {
      mockClient.embed.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2], index: 0 }]
      })
      const embedder = new VoyageEmbedder({ client: mockClient })
      await expect(embedder.embed(["a", "b"])).rejects.toThrow(
        /returned 1 embeddings for 2 inputs/
      )
    })
  })

  describe("embedQuery()", () => {
    it("should call client.embed with input_type query", async () => {
      const embedder = new VoyageEmbedder({ client: mockClient })
      await embedder.embedQuery("test query")

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "voyage-3.5",
        input: ["test query"],
        input_type: "query"
      })
    })

    it("should return a single embedding vector", async () => {
      mockClient.embed.mockResolvedValue({
        data: [{ embedding: [0.5, 0.6, 0.7], index: 0 }]
      })

      const embedder = new VoyageEmbedder({ client: mockClient })
      const result = await embedder.embedQuery("query")

      expect(result).toEqual([0.5, 0.6, 0.7])
    })
  })

  describe("create() HTTP wire contract", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch")
    })
    afterEach(() => vi.restoreAllMocks())

    it("POSTs to the Voyage embeddings endpoint with bearer auth + input_type body", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] })
      )
      const embedder = await VoyageEmbedder.create({ apiKey: "test-key" })
      const result = await embedder.embed(["hello"])

      expect(result).toEqual([[0.1, 0.2, 0.3]])
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.voyageai.com/v1/embeddings")
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key"
        }
      })
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        model: "voyage-3.5",
        input: ["hello"],
        input_type: "document"
      })
    })

    it("throws a clear error when no API key is available", async () => {
      const prev = process.env.VOYAGE_API_KEY
      delete process.env.VOYAGE_API_KEY
      await expect(VoyageEmbedder.create()).rejects.toThrow(/Voyage API key/)
      if (prev !== undefined) process.env.VOYAGE_API_KEY = prev
    })
  })
})
