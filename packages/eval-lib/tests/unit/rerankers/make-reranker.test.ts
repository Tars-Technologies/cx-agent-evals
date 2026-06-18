import { beforeEach, describe, expect, it } from "vitest"
import { makeReranker } from "../../../src/rerankers/make-reranker.js"

describe("makeReranker", () => {
  beforeEach(() => {
    process.env.COHERE_API_KEY = "cohere-key"
    process.env.JINA_API_KEY = "jina-key"
    process.env.VOYAGE_API_KEY = "voyage-key"
  })

  it("defaults to a Cohere reranker", async () => {
    const reranker = await makeReranker()
    expect(reranker.name).toBe("Cohere(rerank-english-v3.0)")
  })

  it("builds a Jina reranker", async () => {
    const reranker = await makeReranker({ provider: "jina" })
    expect(reranker.name).toBe("Jina(jina-reranker-v2-base-multilingual)")
  })

  it("builds a Voyage reranker", async () => {
    const reranker = await makeReranker({ provider: "voyage" })
    expect(reranker.name).toBe("Voyage(rerank-2.5)")
  })

  it("honors a custom model", async () => {
    const reranker = await makeReranker({
      provider: "cohere",
      model: "rerank-v3.5"
    })
    expect(reranker.name).toBe("Cohere(rerank-v3.5)")
  })

  it("throws on an unknown provider", async () => {
    await expect(
      // @ts-expect-error - exercising the runtime guard
      makeReranker({ provider: "nope" })
    ).rejects.toThrow(/Unknown reranker provider: nope/)
  })
})
