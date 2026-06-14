/**
 * Audit #3: map reranker results back to the original chunks safely. Filters
 * out-of-range indices (a malformed response must not inject `undefined`) and
 * caps the output to topK.
 *
 * If filtering drops indices and the result is shorter than the caller asked
 * for, emit a non-throwing warning: a legitimately short candidate list must
 * still work, but a silently truncated result is worth surfacing.
 */
export function mapRerankResults<T>(
  results: ReadonlyArray<{ index: number }>,
  chunks: readonly T[],
  topK?: number
): T[] {
  const mapped = results
    .filter((r) => chunks[r.index] !== undefined)
    .slice(0, topK ?? chunks.length)
    .map((r) => chunks[r.index])

  // How many results the caller could reasonably expect, ignoring index drops.
  const requested = Math.min(topK ?? results.length, results.length)
  if (mapped.length < requested) {
    console.warn(
      `mapRerankResults: returning ${mapped.length} of ${requested} requested results (some indices were out of range)`
    )
  }

  return mapped
}
