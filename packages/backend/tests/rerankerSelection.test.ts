import { describe, expect, it } from "vitest"
import { resolveRerankerSelection } from "../convex/kb/reranker_selection"

const ai = {
  openaiApiKey: "openai",
  cohereApiKey: "cohere-key",
  jinaApiKey: "jina-key",
  voyageApiKey: undefined
} as const

describe("resolveRerankerSelection", () => {
  it("returns undefined when there is no rerank step", () => {
    expect(
      resolveRerankerSelection([{ type: "threshold", minScore: 0.3 }], ai)
    ).toBeUndefined()
  })

  it("defaults to cohere when the rerank step has no provider", () => {
    expect(resolveRerankerSelection([{ type: "rerank", topN: 5 }], ai)).toEqual({
      provider: "cohere",
      model: undefined,
      apiKey: "cohere-key"
    })
  })

  it("reads provider and model off the rerank step", () => {
    expect(
      resolveRerankerSelection(
        [{ type: "rerank", provider: "jina", model: "jina-reranker-v2-base-multilingual" }],
        ai
      )
    ).toEqual({
      provider: "jina",
      model: "jina-reranker-v2-base-multilingual",
      apiKey: "jina-key"
    })
  })

  it("returns undefined (graceful skip) when the provider key is unset", () => {
    expect(
      resolveRerankerSelection([{ type: "rerank", provider: "voyage" }], ai)
    ).toBeUndefined()
  })

  it("returns undefined for an unknown provider", () => {
    expect(
      resolveRerankerSelection([{ type: "rerank", provider: "bogus" }], ai)
    ).toBeUndefined()
  })

  it("uses the first rerank step when several are present", () => {
    const sel = resolveRerankerSelection(
      [
        { type: "rerank", provider: "jina" },
        { type: "rerank", provider: "voyage" }
      ],
      ai
    )
    expect(sel?.provider).toBe("jina")
  })
})
