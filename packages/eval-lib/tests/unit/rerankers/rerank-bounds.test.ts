import { afterEach, describe, expect, it, vi } from "vitest"
import { mapRerankResults } from "../../../src/rerankers/rerank-bounds.js"

describe("mapRerankResults", () => {
  const chunks = ["a", "b", "c"]

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("maps result indices back to chunks in result order", () => {
    const out = mapRerankResults([{ index: 2 }, { index: 0 }], chunks, 2)
    expect(out).toEqual(["c", "a"])
  })

  it("drops out-of-range indices instead of emitting undefined", () => {
    const out = mapRerankResults([{ index: 5 }, { index: 1 }], chunks)
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

  it("warns (non-throwing) when fewer than requested are returned (B2)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    // 3 entries requested but one index is out of range and gets filtered,
    // so only 2 chunks come back: short of the request.
    const out = mapRerankResults(
      [{ index: 0 }, { index: 9 }, { index: 1 }],
      chunks,
      3
    )

    expect(out).toEqual(["a", "b"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("does not warn when the full requested count is returned (B2)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const out = mapRerankResults(
      [{ index: 0 }, { index: 1 }, { index: 2 }],
      chunks,
      3
    )

    expect(out).toEqual(["a", "b", "c"])
    expect(warn).not.toHaveBeenCalled()
  })
})
