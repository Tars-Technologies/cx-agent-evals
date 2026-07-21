import { createHash } from "node:crypto"
import type { Schemas } from "@qdrant/js-client-rest"
import { HttpError, requestJSON } from "../utils/fetch-json.js"

/**
 * Dense-only Qdrant store for KB media (image/video) context embeddings. Kept
 * separate from the chunk-shaped {@link QdrantVectorStore}: media points are
 * keyed by a stable `imageId` (not a chunk-scope hash), carry a media payload
 * (alt/mediaType) rather than character offsets, and are read by **id lookup**
 * — the doc-gated menu already knows exactly which images to score — instead of
 * ANN search. Vectors live here so the `kbMedia` Convex table stays vector-free.
 */

function sanitizeCollectionPart(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_")
}

/**
 * One media collection per (provider, model). The `kb_media_` prefix keeps it
 * disjoint from chunk collections (`kb_vec_`) in the same Qdrant instance, so
 * media and chunk vectors never share a collection.
 */
export function mediaCollectionName(provider: string, model: string): string {
  return `kb_media_${sanitizeCollectionPart(provider)}_${sanitizeCollectionPart(model)}`
}

/**
 * Deterministic UUID-format point id from the media `imageId`. `imageId` is
 * already `sha256(kbId + url)`-derived, so it is globally unique on its own and
 * needs no extra scope — unlike chunk points, which hash the full tenant scope.
 */
export function mediaPointId(imageId: string): string {
  const h = createHash("sha256").update(imageId).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export interface QdrantMediaStoreConfig {
  /** Base URL including port, e.g. https://xyz.cloud.qdrant.io:6333 */
  readonly url: string
  /** API key sent as the `api-key` header. Optional for unsecured local instances. */
  readonly apiKey?: string
  /** Collection name (see {@link mediaCollectionName}). */
  readonly collection: string
  /** Vector dimension; the collection is created/validated against it. */
  readonly dimension: number
  readonly retry?: { readonly maxRetries?: number; readonly backoffMs?: number }
  /** Per-request timeout in ms. Default 30000. */
  readonly timeoutMs?: number
}

export interface MediaUpsertItem {
  readonly imageId: string
  readonly embedding: readonly number[]
  readonly alt: string
  readonly mediaType: "image" | "video"
}

export interface MediaScope {
  readonly kbId: string
  readonly orgId: string
  readonly sourceDocId: string
}

interface MediaPayload {
  imageId: string
  kbId: string
  orgId: string
  sourceDocId: string
  alt: string
  mediaType: string
}

export class QdrantMediaStore {
  readonly name = "qdrant-media"
  private readonly _cfg: QdrantMediaStoreConfig
  private _collectionEnsured = false

  constructor(config: QdrantMediaStoreConfig) {
    let endpoint: URL
    try {
      endpoint = new URL(config.url)
    } catch {
      throw new Error("QdrantMediaStore: url must be a valid HTTPS URL")
    }
    if (endpoint.protocol !== "https:") {
      throw new Error("QdrantMediaStore: url must use HTTPS")
    }
    this._cfg = config
  }

  private async _request<T>(
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    retryOverride?: QdrantMediaStoreConfig["retry"]
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (this._cfg.apiKey) headers["api-key"] = this._cfg.apiKey
    return requestJSON<T>({
      url: `${this._cfg.url}${path}`,
      method,
      body,
      headers,
      provider: "Qdrant",
      retry: retryOverride ?? this._cfg.retry,
      timeoutMs: this._cfg.timeoutMs ?? 30_000,
      // Qdrant never redirects; refuse to follow one so the api-key header
      // cannot leak to a redirect target.
      redirect: "error",
      errorFactory: (status, _statusText, text) =>
        new QdrantMediaHttpError(status, text)
    })
  }

  /** Create the collection (dense, Cosine, hardened) if absent; add payload indexes. */
  async ensureCollection(): Promise<void> {
    if (this._collectionEnsured) return
    try {
      await this._verifyCollectionDimension()
    } catch (err) {
      if (err instanceof QdrantMediaHttpError && err.status === 404) {
        try {
          await this._request(
            "PUT",
            `/collections/${this._cfg.collection}`,
            this._createCollectionBody()
          )
        } catch (createErr) {
          // Concurrent creators race; the loser gets a 409 — re-verify instead.
          if (
            createErr instanceof QdrantMediaHttpError &&
            createErr.status === 409
          ) {
            await this._verifyCollectionDimension()
          } else {
            throw createErr
          }
        }
      } else {
        throw err
      }
    }
    await this._createPayloadIndexes()
    this._collectionEnsured = true
  }

  private _createCollectionBody(): Schemas["CreateCollection"] {
    return {
      vectors: {
        size: this._cfg.dimension,
        distance: "Cosine",
        on_disk: true
      },
      on_disk_payload: true,
      // Per-tenant subgraphs (no global graph); every read filters on kbId.
      hnsw_config: { m: 0, payload_m: 16 },
      quantization_config: { scalar: { type: "int8", always_ram: true } }
    }
  }

  /** Index the payload fields used for filtered delete / tenant isolation. */
  private async _createPayloadIndexes(): Promise<void> {
    const fields: Array<[string, Schemas["PayloadFieldSchema"]]> = [
      ["kbId", { type: "keyword", is_tenant: true }],
      ["sourceDocId", "keyword"]
    ]
    for (const [field, fieldSchema] of fields) {
      try {
        await this._request(
          "PUT",
          `/collections/${this._cfg.collection}/index?wait=true`,
          { field_name: field, field_schema: fieldSchema }
        )
      } catch (err) {
        if (!(err instanceof QdrantMediaHttpError && err.status === 409)) {
          throw err
        }
      }
    }
  }

  private async _verifyCollectionDimension(): Promise<void> {
    const info = await this._request<{
      result?: Schemas["CollectionInfo"]
    }>("GET", `/collections/${this._cfg.collection}`, undefined, {
      maxRetries: 0
    })
    const vectors = info.result?.config?.params?.vectors
    const size =
      vectors && typeof (vectors as { size?: unknown }).size === "number"
        ? (vectors as { size: number }).size
        : undefined
    if (size === undefined) {
      throw new Error(
        `Qdrant collection "${this._cfg.collection}" reported no vector size; refusing to use it`
      )
    }
    if (size !== this._cfg.dimension) {
      throw new Error(
        `Qdrant collection "${this._cfg.collection}" has dimension ${size}, expected ${this._cfg.dimension}`
      )
    }
  }

  /** Insert/replace media points, keyed idempotently by imageId. */
  async upsert(
    items: readonly MediaUpsertItem[],
    scope: MediaScope
  ): Promise<void> {
    if (items.length === 0) return
    for (const item of items) {
      if (item.embedding.length !== this._cfg.dimension) {
        throw new Error(
          `QdrantMediaStore.upsert: embedding for ${item.imageId} has dimension ${item.embedding.length}, expected ${this._cfg.dimension}`
        )
      }
    }
    await this.ensureCollection()
    const points = items.map((item) => ({
      id: mediaPointId(item.imageId),
      vector: [...item.embedding],
      payload: {
        imageId: item.imageId,
        kbId: scope.kbId,
        orgId: scope.orgId,
        sourceDocId: scope.sourceDocId,
        alt: item.alt,
        mediaType: item.mediaType
      } satisfies MediaPayload
    }))
    await this._request(
      "PUT",
      `/collections/${this._cfg.collection}/points?wait=true`,
      { points }
    )
  }

  /**
   * Fetch vectors for a set of imageIds. Drops any point whose payload `kbId`
   * differs from the requested tenant (defense-in-depth). An unprovisioned
   * collection (404) yields `[]`, matching the chunk store's read parity.
   */
  async fetchByIds(
    imageIds: readonly string[],
    scope: { kbId: string }
  ): Promise<Array<{ imageId: string; embedding: number[] }>> {
    if (imageIds.length === 0) return []
    let response: {
      result?: Array<{
        vector?: number[]
        payload?: Partial<MediaPayload>
      }>
    }
    try {
      response = await this._request(
        "POST",
        `/collections/${this._cfg.collection}/points`,
        {
          ids: imageIds.map((id) => mediaPointId(id)),
          with_vector: true,
          with_payload: true
        }
      )
    } catch (err) {
      if (err instanceof QdrantMediaHttpError && err.status === 404) return []
      throw err
    }
    const out: Array<{ imageId: string; embedding: number[] }> = []
    for (const p of response.result ?? []) {
      if (!p.payload || p.payload.kbId !== scope.kbId) continue
      if (!p.payload.imageId || !Array.isArray(p.vector)) continue
      out.push({ imageId: p.payload.imageId, embedding: p.vector })
    }
    return out
  }

  /**
   * Delete specific media points by imageId. Used to reconcile the media a
   * re-scrape no longer references, without touching unchanged points.
   */
  async deleteByIds(imageIds: readonly string[]): Promise<void> {
    if (imageIds.length === 0) return
    try {
      await this._request(
        "POST",
        `/collections/${this._cfg.collection}/points/delete?wait=true`,
        { points: imageIds.map((id) => mediaPointId(id)) }
      )
    } catch (err) {
      if (!(err instanceof QdrantMediaHttpError && err.status === 404)) throw err
    }
  }

  /** Delete every media point for a source document (filtered by kbId+sourceDocId). */
  async deleteBySourceDoc(
    sourceDocId: string,
    scope: { kbId: string }
  ): Promise<void> {
    try {
      await this._request(
        "POST",
        `/collections/${this._cfg.collection}/points/delete?wait=true`,
        {
          filter: {
            must: [
              { key: "kbId", match: { value: scope.kbId } },
              { key: "sourceDocId", match: { value: sourceDocId } }
            ]
          }
        }
      )
    } catch (err) {
      // A missing collection is the desired end-state; delete may be replayed
      // against a collection that was never created.
      if (!(err instanceof QdrantMediaHttpError && err.status === 404)) throw err
    }
  }
}

class QdrantMediaHttpError extends HttpError {
  constructor(status: number, body: string) {
    super(status, `Qdrant API error: ${status} - ${body}`)
  }
}
