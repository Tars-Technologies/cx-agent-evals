import { describe, expect, it } from "vitest"
import { mapRerankResults } from "../../../src/rerankers/rerank-bounds.js"

describe("mapRerankResults", () => {
  const chunks = ["a", "b", "c"]

  it("maps result indices back to chunks in result order", () => {
    const out = mapRerankResults(
      [{ index: 2 }, { index: 0 }],
      chunks,
      2
    )
    expect(out).toEqual(["c", "a"])
  })

  it("drops out-of-range indices instead of emitting undefined", () => {
    const out = mapRerankResults(
      [{ index: 5 }, { index: 1 }],
      chunks
    )
    expect(out).toEqual(["b"])
  })

  it("caps the output to topK", () => {
    const out = mapRerankResults(
      [{ index: 0 }, { index: 1 }, { index: 2 }],
      chunks,
      2
    )
    expect(out).toEqual(["a", "b"])
  })

  it("defaults topK to chunks.length when omitted", () => {
    const out = mapRerankResults(
      [{ index: 0 }, { index: 1 }, { index: 2 }],
      chunks
    )
    expect(out).toEqual(["a", "b", "c"])
  })
})
