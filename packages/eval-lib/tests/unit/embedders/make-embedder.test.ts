import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const openAiCtor = vi.fn()
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation((opts: unknown) => {
    openAiCtor(opts)
    return { embeddings: { create: vi.fn() } }
  })
}))

import { makeEmbedder } from "../../../src/embedders/make-embedder.js"

describe("makeEmbedder", () => {
  beforeEach(() => {
    openAiCtor.mockClear()
    process.env.OPENAI_API_KEY = "openai-key"
    process.env.OPENROUTER_API_KEY = "openrouter-key"
    process.env.COHERE_API_KEY = "cohere-key"
  })
  afterEach(() => vi.clearAllMocks())

  it("defaults to an OpenAI embedder", async () => {
    const embedder = await makeEmbedder()
    expect(embedder.name).toBe("OpenAI(text-embedding-3-small)")
    expect(openAiCtor).toHaveBeenCalledWith({ apiKey: "openai-key" })
  })

  it("builds an OpenRouter embedder reusing OpenAIEmbedder with the openrouter baseURL", async () => {
    const embedder = await makeEmbedder({
      provider: "openrouter",
      model: "openai/text-embedding-3-small"
    })
    expect(embedder.name).toBe("OpenAI(openai/text-embedding-3-small)")
    expect(openAiCtor).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      baseURL: "https://openrouter.ai/api/v1"
    })
  })

  it("builds a Cohere embedder", async () => {
    const embedder = await makeEmbedder({ provider: "cohere" })
    expect(embedder.name).toBe("Cohere(embed-english-v3.0)")
  })

  it("throws on an unknown provider", async () => {
    await expect(
      // @ts-expect-error - exercising the runtime guard
      makeEmbedder({ provider: "nope" })
    ).rejects.toThrow(/Unknown embedder provider: nope/)
  })
})
