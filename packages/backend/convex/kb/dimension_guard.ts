/**
 * The Convex `documentChunks.by_embedding` vector index is hard-locked to 1536
 * dimensions, and Convex rejects wrong-dimension vectors at write time. Guard
 * at construction so a misconfigured embedder fails loudly with a clear message
 * instead of cryptically mid-batch. This guard applies ONLY to the native
 * vector backend; the Qdrant path creates its collection at the embedder's
 * dimension and skips this check.
 */
export const REQUIRED_EMBED_DIMENSION = 1536

export function assertIndexableDimension(
  dimension: number,
  model: string | undefined
): void {
  if (dimension !== REQUIRED_EMBED_DIMENSION) {
    throw new Error(
      `KB indexing requires a ${REQUIRED_EMBED_DIMENSION}-dimension embedder ` +
        `(text-embedding-3-small). Model "${model ?? "text-embedding-3-small"}" ` +
        `produces ${dimension} dimensions. Other dimensions will be supported ` +
        `with the Qdrant vector store.`
    )
  }
}
