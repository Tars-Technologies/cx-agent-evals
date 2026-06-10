/**
 * Edge-safe vector-backend helpers (no eval-lib imports) shared by
 * default-runtime mutations (kb/indexing.ts) and node actions.
 */
export type VectorBackend = "native" | "qdrant"

export function resolveVectorBackend(value: unknown): VectorBackend {
  return value === "qdrant" ? "qdrant" : "native"
}

/**
 * One Qdrant collection per (kbId, indexConfigHash). Stored on the indexing
 * job and retriever at creation time. Do not recompute elsewhere except for
 * the legacy experiment path, which has no retriever record.
 */
export function qdrantCollectionName(
  kbId: string,
  indexConfigHash: string
): string {
  return `kb_${kbId}_${indexConfigHash.slice(0, 16)}`
}
