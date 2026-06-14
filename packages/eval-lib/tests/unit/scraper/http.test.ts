import { describe, expect, it } from "vitest"
import { readCappedText } from "../../../src/scraper/http.js"

function textResponse(body: string): Response {
  // No body stream → exercises the res.text() fallback path (used by test mocks).
  return { text: () => Promise.resolve(body) } as unknown as Response
}

function streamResponse(body: string): Response {
  const bytes = new TextEncoder().encode(body)
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      }
    })
  } as unknown as Response
}

describe("readCappedText", () => {
  it("truncates silently by default when the body exceeds the cap", async () => {
    expect(await readCappedText(textResponse("x".repeat(100)), 10)).toBe(
      "x".repeat(10)
    )
    expect(await readCappedText(streamResponse("x".repeat(100)), 10)).toBe(
      "x".repeat(10)
    )
  })

  it("throws a clear size error when throwOnTruncate is set", async () => {
    // Prevents a content page larger than the cap from being silently truncated
    // mid-JSON into a misleading 'expected JSON' parse error.
    await expect(
      readCappedText(streamResponse("x".repeat(100)), 10, {
        throwOnTruncate: true
      })
    ).rejects.toThrow(/exceeded 10 bytes/)
    await expect(
      readCappedText(textResponse("x".repeat(100)), 10, { throwOnTruncate: true })
    ).rejects.toThrow(/exceeded 10 bytes/)
  })

  it("returns the full body unchanged when within the cap", async () => {
    expect(
      await readCappedText(streamResponse("hello"), 100, {
        throwOnTruncate: true
      })
    ).toBe("hello")
  })
})
