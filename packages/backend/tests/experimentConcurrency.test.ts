import { describe, expect, it } from "vitest"
import {
  DEFAULT_EXPERIMENT_CONCURRENCY,
  MAX_EXPERIMENT_CONCURRENCY,
  MIN_EXPERIMENT_CONCURRENCY,
  resolveMaxConcurrency
} from "../convex/lib/experimentConcurrency"

describe("resolveMaxConcurrency", () => {
  it("returns the default when no value is provided", () => {
    expect(resolveMaxConcurrency(undefined)).toBe(
      DEFAULT_EXPERIMENT_CONCURRENCY
    )
  })

  it("uses a valid numeric string", () => {
    expect(resolveMaxConcurrency("5")).toBe(5)
  })

  it("uses a valid number", () => {
    expect(resolveMaxConcurrency(4)).toBe(4)
  })

  it("floors fractional values", () => {
    expect(resolveMaxConcurrency("3.9")).toBe(3)
  })

  it("falls back to the default for non-numeric input", () => {
    expect(resolveMaxConcurrency("abc")).toBe(DEFAULT_EXPERIMENT_CONCURRENCY)
    expect(resolveMaxConcurrency("")).toBe(DEFAULT_EXPERIMENT_CONCURRENCY)
  })

  it("clamps below the minimum", () => {
    expect(resolveMaxConcurrency(0)).toBe(MIN_EXPERIMENT_CONCURRENCY)
    expect(resolveMaxConcurrency("-2")).toBe(MIN_EXPERIMENT_CONCURRENCY)
  })

  it("clamps above the maximum", () => {
    expect(resolveMaxConcurrency(999)).toBe(MAX_EXPERIMENT_CONCURRENCY)
  })
})
