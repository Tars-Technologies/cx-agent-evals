import { describe, expect, it } from "vitest"
import {
  assertEmbeddingBatch,
  reorderByIndex
} from "../../../src/embedders/embedding-batch.js"

describe("reorderByIndex", () => {
  it("sorts items by their index field ascending", () => {
    const items = [
      { index: 2, embedding: [0.3] },
      { index: 0, embedding: [0.1] },
      { index: 1, embedding: [0.2] }
    ]
    expect(reorderByIndex(items)).toEqual([
      { index: 0, embedding: [0.1] },
      { index: 1, embedding: [0.2] },
      { index: 2, embedding: [0.3] }
    ])
  })

  it("does not mutate the input array", () => {
    const items = [
      { index: 1, embedding: [0.2] },
      { index: 0, embedding: [0.1] }
    ]
    reorderByIndex(items)
    expect(items[0].index).toBe(1)
  })

  it("throws on duplicate indices", () => {
    const items = [
      { index: 0, embedding: [0.1] },
      { index: 0, embedding: [0.2] }
    ]
    expect(() => reorderByIndex(items)).toThrow(
      /index mismatch at position 1 \(got 0\)/
    )
  })

  it("throws on missing indices", () => {
    const items = [
      { index: 0, embedding: [0.1] },
      { index: 2, embedding: [0.3] }
    ]
    expect(() => reorderByIndex(items)).toThrow(
      /index mismatch at position 1 \(got 2\)/
    )
  })
})

describe("assertEmbeddingBatch", () => {
  it("passes when count matches and all vectors share a length", () => {
    expect(() =>
      assertEmbeddingBatch(
        [
          [0.1, 0.2],
          [0.3, 0.4]
        ],
        2,
        "TestProvider"
      )
    ).not.toThrow()
  })

  it("throws when the returned count does not match the input count", () => {
    expect(() => assertEmbeddingBatch([[0.1, 0.2]], 2, "TestProvider")).toThrow(
      /TestProvider returned 1 embeddings for 2 inputs/
    )
  })

  it("throws when vectors have inconsistent dimensions", () => {
    expect(() =>
      assertEmbeddingBatch([[0.1, 0.2], [0.3]], 2, "TestProvider")
    ).toThrow(/TestProvider returned embeddings of inconsistent dimension/)
  })

  it("passes for an empty batch with expected count 0", () => {
    expect(() => assertEmbeddingBatch([], 0, "TestProvider")).not.toThrow()
  })
})
