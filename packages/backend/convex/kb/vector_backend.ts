/**
 * Edge-safe vector-backend helpers (no eval-lib imports) shared by
 * default-runtime mutations (kb/indexing.ts) and node actions.
 */
export type VectorBackend = "native" | "qdrant"

export function resolveVectorBackend(value: unknown): VectorBackend {
  return value === "qdrant" ? "qdrant" : "native"
}

/**
 * The native (Convex) vector backend is locked to OpenAI 1536-dim embeddings by
 * the documentChunks vector index. The native indexing path always uses OpenAI,
 * so a non-OpenAI embeddingProvider is silently ignored there yet still skews
 * the index hash, yielding a mislabeled, redundant index. Reject the pairing at
 * the boundary. Qdrant honors any provider and is unaffected.
 */
export function assertEmbeddingBackendCompatible(
  vectorBackend: VectorBackend,
  embeddingProvider: unknown
): void {
  if (
    vectorBackend === "native" &&
    typeof embeddingProvider === "string" &&
    embeddingProvider !== "openai"
  ) {
    throw new Error(
      `The native vector backend supports only the "openai" embedding provider (got "${embeddingProvider}"). Use vectorBackend: "qdrant" for other providers.`
    )
  }
}

function sanitizeCollectionPart(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_")
}

/**
 * One Qdrant collection per (provider, model). Stored on the indexing
 * job and retriever at creation time. Do not recompute elsewhere except for
 * the legacy experiment path, which has no retriever record.
 */
export function qdrantCollectionName(provider: string, model: string): string {
  return `kb_vec_${sanitizeCollectionPart(provider)}_${sanitizeCollectionPart(model)}`
}
