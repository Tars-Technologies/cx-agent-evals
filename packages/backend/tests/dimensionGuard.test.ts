import { describe, expect, it } from "vitest"
import {
  assertIndexableDimension,
  REQUIRED_EMBED_DIMENSION
} from "../convex/kb/dimension_guard"

describe("assertIndexableDimension", () => {
  it("accepts the required 1536 dimension", () => {
    expect(() =>
      assertIndexableDimension(
        REQUIRED_EMBED_DIMENSION,
        "text-embedding-3-small"
      )
    ).not.toThrow()
  })

  it("rejects a mismatched dimension with a clear message", () => {
    expect(() =>
      assertIndexableDimension(3072, "text-embedding-3-large")
    ).toThrow(/1536-dimension/)
  })

  it("names the offending model and its dimension", () => {
    expect(() =>
      assertIndexableDimension(3072, "text-embedding-3-large")
    ).toThrow(/text-embedding-3-large/)
  })
})
