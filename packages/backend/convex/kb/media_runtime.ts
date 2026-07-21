"use node"

/**
 * Media (image/video) vector runtime: the Qdrant seam for kbMedia context
 * embeddings, plus the doc-gated ranking helper. Carries "use node" because it
 * imports the eval-lib media store (node:crypto for point ids). Imported ONLY by
 * "use node" action files (images_actions, agentLoop, agents/actions,
 * experiments/agentActions); registers no Convex functions, only helpers.
 */

import {
  mediaCollectionName,
  QdrantMediaStore
} from "@tars-inc/eval-lib"
import {
  type ImageMenuEntry,
  rankDocImagesForQuery
} from "@tars-inc/eval-lib/multimodal"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { backendConfig } from "../config"

// kbMedia context embeddings always use the default OpenAI text embedder
// (createEmbedder() with no model). The collection name is derived from this
// fixed identity, so index-time and read-time address the same collection.
export const MEDIA_EMBEDDING_PROVIDER = "openai"
export const MEDIA_EMBEDDING_MODEL = "text-embedding-3-small"
export const MEDIA_EMBEDDING_DIMENSION = 1536

/** The single media collection name for this deployment's media embedder. */
export function mediaCollectionNameForDefault(): string {
  return mediaCollectionName(MEDIA_EMBEDDING_PROVIDER, MEDIA_EMBEDDING_MODEL)
}

/**
 * Build the Qdrant media store. Fails loudly when the deployment has no
 * QDRANT_URL — media vectors have no Convex fallback after the cutover.
 */
export function buildQdrantMediaStore(dimension: number): QdrantMediaStore {
  const qdrant = backendConfig.qdrant
  if (!qdrant) {
    throw new Error(
      "KB media embeddings are stored in Qdrant, but QDRANT_URL is not set in " +
        "the deployment environment. Set QDRANT_URL (and QDRANT_API_KEY if " +
        "required), restart the Convex worker, and retry."
    )
  }
  return new QdrantMediaStore({
    url: qdrant.url,
    apiKey: qdrant.apiKey,
    collection: mediaCollectionNameForDefault(),
    dimension
  })
}

/**
 * Doc-gated image menu, ranked in the action: pull each retrieved doc's media
 * metadata from Convex, fetch those images' vectors from Qdrant, then rank by
 * cosine to `queryEmbedding` via the shared `rankDocImagesForQuery` — identical
 * output to the pre-Qdrant DB-side ranking. `documentIds` are in retrieved-chunk
 * rank order; menu is round-robined across docs, deduped, capped.
 */
export async function rankMediaForDocs(
  ctx: ActionCtx,
  args: {
    kbId: Id<"knowledgeBases">
    documentIds: Id<"documents">[]
    queryEmbedding: number[]
    cap: number
  }
): Promise<ImageMenuEntry[]> {
  const meta = await ctx.runQuery(internal.kb.images.mediaMetaForDocs, {
    kbId: args.kbId,
    documentIds: args.documentIds
  })
  if (meta.length === 0) return []

  // Fetch vectors for every candidate image in one Qdrant round-trip. The
  // collection dimension is fixed (media embedder); a query of a different
  // dimension still fetches fine and simply falls back to doc-order ranking.
  const store = buildQdrantMediaStore(MEDIA_EMBEDDING_DIMENSION)
  const imageIds = [...new Set(meta.map((m) => m.imageId))]
  const vectors = await store.fetchByIds(imageIds, { kbId: String(args.kbId) })
  const vecById = new Map(vectors.map((v) => [v.imageId, v.embedding]))

  // Rebuild the per-document groups in the same doc order the caller passed,
  // attaching each image's fetched embedding (undefined → falls back to
  // doc-order ranking, exactly as before when a vector was missing).
  const groups = args.documentIds.map((documentId) =>
    meta
      .filter((m) => m.documentId === documentId)
      .map((m) => ({
        imageId: m.imageId,
        alt: m.alt,
        embedding: vecById.get(m.imageId),
        type: m.mediaType as "image" | "video"
      }))
  )
  return rankDocImagesForQuery(args.queryEmbedding, groups, args.cap)
}
