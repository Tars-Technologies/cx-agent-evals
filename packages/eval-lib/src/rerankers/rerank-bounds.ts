/**
 * Audit #3: map reranker results back to the original chunks safely. Filters
 * out-of-range indices (a malformed response must not inject `undefined`) and
 * caps the output to topK.
 */
export function mapRerankResults<T>(
  results: ReadonlyArray<{ index: number }>,
  chunks: readonly T[],
  topK?: number
): T[] {
  return results
    .filter((r) => chunks[r.index] !== undefined)
    .slice(0, topK ?? chunks.length)
    .map((r) => chunks[r.index])
}
