import { describe, expect, it } from "vitest"
import {
  DEFAULT_BM25_AVGDL,
  DEFAULT_BM25_B,
  DEFAULT_BM25_K1,
  encodeDocument,
  encodeQuery,
  stableHash,
  tokenize
} from "../../../../src/vector-stores/sparse/bm25-encoder.js"

describe("bm25-encoder", () => {
  describe("tokenize", () => {
    it("lowercases and splits on runs of non-alphanumeric characters", () => {
      expect(tokenize("Hello, WORLD!  foo_bar  baz")).toEqual([
        "hello",
        "world",
        "foo",
        "bar",
        "baz"
      ])
    })

    it("keeps unicode letters and digits, drops empties", () => {
      expect(tokenize("  café 2024 naïve  ")).toEqual(["café", "2024", "naïve"])
      expect(tokenize("!!! ??? ...")).toEqual([])
    })
  })

  describe("stableHash", () => {
    it("is deterministic and returns an unsigned 32-bit integer", () => {
      const a = stableHash("retrieval")
      expect(stableHash("retrieval")).toBe(a)
      expect(Number.isInteger(a)).toBe(true)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(0xffffffff)
    })

    it("separates distinct tokens", () => {
      expect(stableHash("alpha")).not.toBe(stableHash("bravo"))
    })
  })

  describe("encodeDocument", () => {
    it("is deterministic for the same text and params", () => {
      const a = encodeDocument("the quick brown fox")
      const b = encodeDocument("the quick brown fox")
      expect(a).toEqual(b)
    })

    it("maps the document tokens onto the same indices the query produces", () => {
      // Doc/query tokenizer + hash must agree: every query term index must be
      // present in the document it should match.
      const doc = encodeDocument("alpha bravo charlie alpha")
      const query = encodeQuery("alpha charlie")
      const docIndices = new Set(doc.indices)
      for (const idx of query.indices) {
        expect(docIndices.has(idx)).toBe(true)
      }
    })

    it("produces unique indices and aligned values", () => {
      const { indices, values } = encodeDocument("a a a b b c")
      expect(indices).toHaveLength(values.length)
      expect(new Set(indices).size).toBe(indices.length)
    })

    it("applies the BM25 term-frequency saturation formula", () => {
      // Single-term document: tf = 1, len = 1. Compare against the closed form.
      const { indices, values } = encodeDocument("solo")
      expect(indices).toEqual([stableHash("solo")])
      const tf = 1
      const len = 1
      const norm =
        DEFAULT_BM25_K1 * (1 - DEFAULT_BM25_B + (DEFAULT_BM25_B * len) / DEFAULT_BM25_AVGDL)
      const expected = (tf * (DEFAULT_BM25_K1 + 1)) / (tf + norm)
      expect(values[0]).toBeCloseTo(expected, 10)
    })

    it("saturates: doubling tf less than doubles the weight (k1 effect)", () => {
      const once = encodeDocument("term").values[0]
      const twice = encodeDocument("term term").values[0]
      expect(twice).toBeGreaterThan(once)
      expect(twice).toBeLessThan(2 * once)
    })

    it("honors b = 0 (no length normalization)", () => {
      // With b = 0 the per-term weight is independent of document length.
      const short = encodeDocument("term", { b: 0 })
      const long = encodeDocument("term " + "filler ".repeat(50), { b: 0 })
      const termIdx = stableHash("term")
      const shortVal = short.values[short.indices.indexOf(termIdx)]
      const longVal = long.values[long.indices.indexOf(termIdx)]
      expect(longVal).toBeCloseTo(shortVal, 10)
    })

    it("returns an empty vector for content with no tokens", () => {
      expect(encodeDocument("   !!!  ")).toEqual({ indices: [], values: [] })
    })
  })

  describe("encodeQuery", () => {
    it("is deterministic and assigns value 1 per unique term", () => {
      const a = encodeQuery("retrieval augmented generation")
      expect(encodeQuery("retrieval augmented generation")).toEqual(a)
      expect(a.values.every((v) => v === 1)).toBe(true)
      expect(a.indices).toHaveLength(3)
    })

    it("deduplicates repeated query terms to keep indices unique", () => {
      const { indices, values } = encodeQuery("alpha alpha beta")
      expect(indices).toHaveLength(2)
      expect(values).toEqual([1, 1])
      expect(new Set(indices).size).toBe(indices.length)
    })

    it("returns an empty vector for an all-stopword/punctuation query", () => {
      expect(encodeQuery("--- ???")).toEqual({ indices: [], values: [] })
    })
  })
})
