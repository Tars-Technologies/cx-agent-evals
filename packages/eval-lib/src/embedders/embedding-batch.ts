/**
 * Audit #2 helpers: embedding providers must never trust positional order, and
 * a returned batch must align 1:1 with the input texts.
 */

/**
 * Reorder embedding items by their API-provided `index` field (ascending).
 * Rejects duplicate or missing indices: a malformed index set would pair
 * embeddings to the wrong inputs even when counts and dimensions pass.
 */
export function reorderByIndex<T extends { index: number }>(
  items: readonly T[]
): T[] {
  const sorted = [...items].sort((a, b) => a.index - b.index)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].index !== i) {
      throw new Error(
        `Embedding response index mismatch at position ${i} (got ${sorted[i].index})`
      )
    }
  }
  return sorted
}

/**
 * Assert an embedding batch is well-formed: the count matches the number of
 * inputs and every vector shares the same dimension. We intentionally do NOT
 * assert against a known/expected dimension - matryoshka and unknown models
 * legitimately vary, and the hard dimension gate lives at the vector-store
 * boundary (the backend's 1536 guard).
 */
export function assertEmbeddingBatch(
  vectors: readonly number[][],
  expectedCount: number,
  provider: string
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(
      `${provider} returned ${vectors.length} embeddings for ${expectedCount} inputs`
    )
  }
  if (vectors.length === 0) return
  const dim = vectors[0].length
  if (dim === 0) {
    throw new Error(
      `${provider} returned zero-dimension embeddings (empty vectors)`
    )
  }
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(
        `${provider} returned embeddings of inconsistent dimension (saw ${dim} and ${v.length})`
      )
    }
  }
}
