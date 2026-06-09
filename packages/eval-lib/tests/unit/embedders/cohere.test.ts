import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import { CohereEmbedder } from "../../../src/embedders/cohere.js"

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  } as unknown as Response
}

describe("CohereEmbedder", () => {
  const mockClient = { embed: vi.fn() }

  beforeEach(() => {
    mockClient.embed.mockReset()
    mockClient.embed.mockResolvedValue({
      embeddings: { float: [[0.1, 0.2, 0.3]] }
    })
  })

  describe("constructor", () => {
    it("should use default model when none specified", () => {
      const embedder = new CohereEmbedder({ client: mockClient })
      expect(embedder.name).toBe("Cohere(embed-english-v3.0)")
      expect(embedder.dimension).toBe(1024)
    })

    it("should use specified model", () => {
      const embedder = new CohereEmbedder({
        client: mockClient,
        model: "embed-multilingual-v3.0"
      })
      expect(embedder.name).toBe("Cohere(embed-multilingual-v3.0)")
      expect(embedder.dimension).toBe(1024)
    })
  })

  describe("embed()", () => {
    it("should call client.embed with input_type search_document", async () => {
      const embedder = new CohereEmbedder({
        client: mockClient,
        model: "embed-english-v3.0"
      })
      await embedder.embed(["hello world"])

      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "embed-english-v3.0",
        texts: ["hello world"],
        input_type: "search_document",
        embedding_types: ["float"]
      })
    })

    it("should return embeddings from response", async () => {
      mockClient.embed.mockResolvedValue({
        embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] }
      })
      const embedder = new CohereEmbedder({ client: mockClient })
      const result = await embedder.embed(["text1", "text2"])
      expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]])
    })

    it("should throw when the returned count does not match the input", async () => {
      mockClient.embed.mockResolvedValue({
        embeddings: { float: [[0.1, 0.2]] }
      })
      const embedder = new CohereEmbedder({ client: mockClient })
      await expect(embedder.embed(["a", "b"])).rejects.toThrow(
        /returned 1 embeddings for 2 inputs/
      )
    })
  })

  describe("embedQuery()", () => {
    it("should call client.embed with input_type search_query", async () => {
      const embedder = new CohereEmbedder({ client: mockClient })
      await embedder.embedQuery("test query")
      expect(mockClient.embed).toHaveBeenCalledWith({
        model: "embed-english-v3.0",
        texts: ["test query"],
        input_type: "search_query",
        embedding_types: ["float"]
      })
    })
  })

  describe("create() HTTP wire contract", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch")
    })
    afterEach(() => vi.restoreAllMocks())

    it("POSTs to the Cohere v2 embed endpoint with snake_case body + bearer auth", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ embeddings: { float: [[0.1, 0.2, 0.3]] } })
      )
      const embedder = await CohereEmbedder.create({ apiKey: "test-key" })
      const result = await embedder.embed(["hello"])

      expect(result).toEqual([[0.1, 0.2, 0.3]])
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe("https://api.cohere.com/v2/embed")
      expect(init).toMatchObject({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key"
        }
      })
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        model: "embed-english-v3.0",
        texts: ["hello"],
        input_type: "search_document",
        embedding_types: ["float"]
      })
    })

    it("throws a clear error when no API key is available", async () => {
      const prev = process.env.COHERE_API_KEY
      process.env.COHERE_API_KEY = ""
      await expect(CohereEmbedder.create()).rejects.toThrow(/Cohere API key/)
      if (prev === undefined) delete process.env.COHERE_API_KEY
      else process.env.COHERE_API_KEY = prev
    })
  })
})
