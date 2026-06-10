/**
 * Cap document content to stay under Convex's ~1 MiB per-document limit.
 *
 * Stored markdown (scraped pages, parsed files, remote callbacks) is otherwise
 * written verbatim. An oversized value makes the insert/patch throw, which on the
 * Tarser callback path becomes a 500 the remote service retries until it gives up,
 * leaving the document/job stranded. Truncating with a visible marker keeps the
 * document usable and lets the mutation succeed.
 */

// Leave headroom under the 1 MiB (1048576-byte) limit for the other fields on the
// document (title, metadata, ids, indexes).
export const MAX_CONTENT_BYTES = 1_000_000

const TRUNCATION_MARKER = "\n\n[...truncated: content exceeded size limit]"

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength
}

export interface CappedContent {
  content: string
  truncated: boolean
  originalLength: number
}

/**
 * Return `content` unchanged if it fits the byte budget, otherwise the largest
 * UTF-8-safe prefix plus a truncation marker. Byte-aware so multi-byte content
 * cannot slip past the limit.
 */
export function capContent(
  content: string,
  maxBytes: number = MAX_CONTENT_BYTES
): CappedContent {
  const originalLength = content.length
  if (utf8ByteLength(content) <= maxBytes) {
    return { content, truncated: false, originalLength }
  }
  const budget = maxBytes - utf8ByteLength(TRUNCATION_MARKER)
  // Binary-search the longest character prefix whose UTF-8 encoding fits the budget.
  let lo = 0
  let hi = content.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (utf8ByteLength(content.slice(0, mid)) <= budget) lo = mid
    else hi = mid - 1
  }
  return {
    content: content.slice(0, lo) + TRUNCATION_MARKER,
    truncated: true,
    originalLength
  }
}
