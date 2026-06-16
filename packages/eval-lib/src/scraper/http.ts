/**
 * Shared HTTP helpers for the remote content-service clients (Tarser, Asimov).
 * Kept pure and Convex-agnostic: only fetch + streaming primitives.
 */

// Control-plane responses (job-accepted envelopes, status, error bodies) are tiny.
// Cap the read so a large or hostile service/proxy response cannot be buffered
// unbounded into the action before JSON.parse / error formatting.
export const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024

// Content pages (a drained crawl/parse) can be tens of MB. A separate, larger
// cap bounds a single paginated page so a hostile/oversized response still can't
// be buffered without limit, while leaving generous room for legitimate content.
export const MAX_CONTENT_RESPONSE_BYTES = 64 * 1024 * 1024

// Asimov's /status embeds URL lists that grow with crawl size, so it overflows
// the 64 KB control cap. Intermediate cap: fits the lists, still bounds the body.
export const MAX_STATUS_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * Read a response body as text, decoding at most ~maxBytes. Streams
 * chunk-by-chunk and slices each chunk to the remaining budget before decoding,
 * so a server that omits or lies about Content-Length never has more than
 * maxBytes decoded into memory here. Falls back to response.text() when no
 * readable body stream is available (test mocks).
 *
 * By default truncates rather than throwing, so the bounded text is usable for
 * error diagnostics. Pass `throwOnTruncate` for bodies that must parse whole
 * (e.g. a JSON content page) so an oversized response fails loudly instead of
 * being silently cut mid-JSON into a misleading parse error.
 */
export async function readCappedText(
  res: Response,
  maxBytes = MAX_CONTROL_RESPONSE_BYTES,
  opts?: { throwOnTruncate?: boolean }
): Promise<string> {
  const tooLarge = (): never => {
    throw new Error(`Response body exceeded ${maxBytes} bytes`)
  }
  if (!res.body) {
    const text = await res.text()
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      if (opts?.throwOnTruncate) tooLarge()
      return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")
    }
    return text
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let result = ""
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - received
      if (value.byteLength > remaining) {
        result += decoder.decode(value.subarray(0, remaining), { stream: true })
        truncated = true
        break
      }
      received += value.byteLength
      result += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  result += decoder.decode()
  if (truncated && opts?.throwOnTruncate) tooLarge()
  return result
}
