import { describe, expect, it } from "vitest"
import { isRetryableHttpStatus, withRetry } from "../../../src/utils/retry.js"

describe("withRetry", () => {
  it("retries up to maxRetries by default", async () => {
    let calls = 0
    const fn = async () => {
      calls++
      if (calls < 3) throw new Error("transient")
      return "ok"
    }
    expect(await withRetry(fn, { maxRetries: 3, backoffMs: 0 })).toBe("ok")
    expect(calls).toBe(3)
  })

  it("fails fast (no retries) when shouldRetry returns false", async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw new Error("non-retryable")
    }
    await expect(
      withRetry(fn, { maxRetries: 3, backoffMs: 0, shouldRetry: () => false })
    ).rejects.toThrow("non-retryable")
    expect(calls).toBe(1)
  })
})

describe("isRetryableHttpStatus", () => {
  it("retries network errors (undefined status)", () => {
    expect(isRetryableHttpStatus(undefined)).toBe(true)
  })

  it("retries 408, 429, and 5xx", () => {
    expect(isRetryableHttpStatus(408)).toBe(true)
    expect(isRetryableHttpStatus(429)).toBe(true)
    expect(isRetryableHttpStatus(500)).toBe(true)
    expect(isRetryableHttpStatus(503)).toBe(true)
  })

  it("does not retry other 4xx client errors", () => {
    expect(isRetryableHttpStatus(400)).toBe(false)
    expect(isRetryableHttpStatus(401)).toBe(false)
    expect(isRetryableHttpStatus(403)).toBe(false)
    expect(isRetryableHttpStatus(404)).toBe(false)
  })
})
