import { describe, expect, it } from "vitest"
import { OpenAIEmbedder } from "../../../src/embedders/openai.js"

function client(data: Array<{ embedding: number[]; index: number }>) {
  return { embeddings: { create: async () => ({ data }) } }
}

describe("OpenAIEmbedder", () => {
  it("reorders embeddings by the API-provided index, not array position", async () => {
    // The API (and OpenRouter as an aggregator) may return rows out of order;
    // correct pairing of input -> vector requires sorting by `index`.
    const embedder = new OpenAIEmbedder({
      client: client([
        { embedding: [2, 2], index: 1 },
        { embedding: [1, 1], index: 0 }
      ])
    })

    const vectors = await embedder.embed(["a", "b"])

    expect(vectors).toEqual([
      [1, 1], // index 0 -> input "a"
      [2, 2] // index 1 -> input "b"
    ])
  })

  it("throws when the returned batch count does not match the inputs", async () => {
    const embedder = new OpenAIEmbedder({
      client: client([{ embedding: [1, 1], index: 0 }])
    })

    await expect(embedder.embed(["a", "b"])).rejects.toThrow(
      /1 embeddings for 2/
    )
  })

  it("embedQuery returns the single query vector", async () => {
    const embedder = new OpenAIEmbedder({
      client: client([{ embedding: [9, 9], index: 0 }])
    })

    expect(await embedder.embedQuery("q")).toEqual([9, 9])
  })
})
