/**
 * Shared HTTP helpers for the remote content-service clients (Tarser, Asimov).
 * Kept pure and Convex-agnostic: only fetch + streaming primitives.
 */

// Control-plane responses (job-accepted envelopes, status, error bodies) are tiny.
// Cap the read so a large or hostile service/proxy response cannot be buffered
// unbounded into the action before JSON.parse / error formatting.
export const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024

// Content pages (a drained crawl/parse) can be several MB. A separate, larger
// cap bounds a single paginated page so a hostile/oversized response still can't
// be buffered without limit, while leaving room for legitimate content.
export const MAX_CONTENT_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * Read a response body as text, decoding at most ~maxBytes. Streams
 * chunk-by-chunk and slices each chunk to the remaining budget before decoding,
 * so a server that omits or lies about Content-Length never has more than
 * maxBytes decoded into memory here. Truncates rather than throwing, so the
 * bounded text is usable for both JSON parsing and error diagnostics. Falls back
 * to response.text() when no readable body stream is available (test mocks).
 */
export async function readCappedText(
  res: Response,
  maxBytes = MAX_CONTROL_RESPONSE_BYTES
): Promise<string> {
  if (!res.body) {
    const text = await res.text()
    return Buffer.byteLength(text, "utf8") > maxBytes
      ? Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")
      : text
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let result = ""
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - received
      const slice =
        value.byteLength > remaining ? value.subarray(0, remaining) : value
      received += slice.byteLength
      result += decoder.decode(slice, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  result += decoder.decode()
  return result
}
