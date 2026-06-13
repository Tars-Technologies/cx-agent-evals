import { createHash } from "node:crypto"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../types/index.js"
import { isRetryableHttpStatus, withRetry } from "../utils/retry.js"
import type {
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from "./vector-store.interface.js"

export interface QdrantVectorStoreConfig {
  /** Base URL including port, e.g. https://xyz.cloud.qdrant.io:6333 */
  readonly url: string
  /** API key sent as the `api-key` header. Optional for unsecured local instances. */
  readonly apiKey?: string
  /** Collection name. One collection per (kbId, indexConfigHash) scope. */
  readonly collection: string
  /** Vector dimension; the collection is created/validated against it. */
  readonly dimension: number
  readonly retry?: { readonly maxRetries?: number; readonly backoffMs?: number }
  /** Per-request timeout in ms; aborts a hung fetch so withRetry can retry. Default 30000. */
  readonly timeoutMs?: number
}

/** Deterministic UUID-format point id derived from the chunk id (sha256). */
export function qdrantPointId(chunkId: string): string {
  const h = createHash("sha256").update(chunkId).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

interface QdrantPayload {
  chunkId: string
  content: string
  docId: string
  start: number
  end: number
  metadata: Record<string, unknown>
  kbId?: string
  indexConfigHash?: string
  documentId?: string
}

function buildQdrantFilter(filter?: VectorFilter): unknown {
  if (!filter) return undefined
  const must: unknown[] = []
  for (const key of ["kbId", "indexConfigHash", "documentId"] as const) {
    const value = filter[key]
    if (value !== undefined) must.push({ key, match: { value } })
  }
  return must.length > 0 ? { must } : undefined
}

/**
 * Qdrant-backed VectorStore over the REST API. Payloads are self-contained
 * (chunk text + offsets) so search results need no further hydration.
 * Upserts are idempotent via deterministic point ids.
 */
export class QdrantVectorStore implements VectorStore {
  readonly name = "qdrant"
  private readonly _cfg: QdrantVectorStoreConfig
  private _collectionEnsured = false

  constructor(config: QdrantVectorStoreConfig) {
    this._cfg = config
  }

  private async _request<T>(
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    retryOverride?: QdrantVectorStoreConfig["retry"]
  ): Promise<T> {
    return withRetry(async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      }
      if (this._cfg.apiKey) headers["api-key"] = this._cfg.apiKey
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        this._cfg.timeoutMs ?? 30_000
      )
      try {
        const response = await fetch(`${this._cfg.url}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        })
        if (!response.ok) {
          const text = await response.text()
          throw new QdrantHttpError(response.status, text)
        }
        return (await response.json()) as T
      } finally {
        clearTimeout(timeout)
      }
    }, {
      ...(retryOverride ?? this._cfg.retry),
      // A 4xx (bad api-key, malformed query) will never succeed on retry; only
      // retry transient failures so a bad request fails fast instead of hanging
      // through the full backoff schedule.
      shouldRetry: (err) =>
        isRetryableHttpStatus(
          err instanceof QdrantHttpError ? err.status : undefined
        )
    })
  }

  /** Create the collection if absent; throw on dimension mismatch. */
  async ensureCollection(): Promise<void> {
    if (this._collectionEnsured) return
    try {
      await this._verifyCollectionDimension()
    } catch (err) {
      if (err instanceof QdrantHttpError && err.status === 404) {
        try {
          await this._request("PUT", `/collections/${this._cfg.collection}`, {
            vectors: { size: this._cfg.dimension, distance: "Cosine" }
          })
        } catch (createErr) {
          // Concurrent indexers race to create the same collection; the
          // losers get a 409. Treat it as created, but re-verify dimension.
          if (
            createErr instanceof QdrantHttpError &&
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
    // Ensure payload indexes whether the collection was just created or
    // already existed: a collection created before these indexes were added
    // must be back-filled, or strict-mode Qdrant rejects filtered
    // search/delete. Idempotent (tolerates 409), so safe on every ensure.
    await this._createPayloadIndexes()
    this._collectionEnsured = true
  }

  /**
   * Index the payload fields VectorFilter can target. Strict-mode instances
   * (e.g. Qdrant Cloud) reject filtered search/delete on unindexed fields.
   */
  private async _createPayloadIndexes(): Promise<void> {
    for (const field of ["kbId", "indexConfigHash", "documentId"] as const) {
      try {
        await this._request(
          "PUT",
          `/collections/${this._cfg.collection}/index?wait=true`,
          { field_name: field, field_schema: "keyword" }
        )
      } catch (err) {
        // A concurrent indexer may have created it between our calls.
        if (!(err instanceof QdrantHttpError && err.status === 409)) {
          throw err
        }
      }
    }
  }

  private async _verifyCollectionDimension(): Promise<void> {
    // No retry on this GET: withRetry retries every error, and a 404 here
    // is the expected "collection missing" signal, not a transient failure.
    const info = await this._request<{
      result?: { config?: { params?: { vectors?: { size?: number } } } }
    }>("GET", `/collections/${this._cfg.collection}`, undefined, {
      maxRetries: 0
    })
    const size = info.result?.config?.params?.vectors?.size
    if (size === undefined) {
      // No top-level vector size means an incompatible shape (e.g. named
      // vectors). This store only creates/uses single-vector collections, so
      // fail closed rather than upserting into a collection we can't address.
      throw new Error(
        `Qdrant collection "${this._cfg.collection}" reported no vector size (unexpected shape, e.g. named vectors); refusing to use it`
      )
    }
    if (size !== this._cfg.dimension) {
      throw new Error(
        `Qdrant collection "${this._cfg.collection}" has dimension ${size}, expected ${this._cfg.dimension}`
      )
    }
  }

  async add(
    chunks: readonly PositionAwareChunk[],
    embeddings: readonly number[][],
    scope?: VectorFilter
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error(
        `QdrantVectorStore.add: ${chunks.length} chunks but ${embeddings.length} embeddings`
      )
    }
    for (const e of embeddings) {
      if (e.length !== this._cfg.dimension) {
        throw new Error(
          `QdrantVectorStore.add: embedding has dimension ${e.length}, expected ${this._cfg.dimension}`
        )
      }
    }
    if (chunks.length === 0) return
    await this.ensureCollection()
    const points = chunks.map((chunk, i) => ({
      id: qdrantPointId(String(chunk.id)),
      vector: embeddings[i],
      payload: {
        chunkId: String(chunk.id),
        content: chunk.content,
        docId: String(chunk.docId),
        start: chunk.start,
        end: chunk.end,
        metadata: chunk.metadata ?? {},
        kbId: scope?.kbId,
        indexConfigHash: scope?.indexConfigHash,
        documentId: scope?.documentId
      } satisfies QdrantPayload
    }))
    await this._request(
      "PUT",
      `/collections/${this._cfg.collection}/points?wait=true`,
      { points }
    )
  }

  async search(
    queryEmbedding: readonly number[],
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const body: Record<string, unknown> = {
      query: [...queryEmbedding],
      limit: opts.k,
      with_payload: true
    }
    const filter = buildQdrantFilter(opts.filter)
    if (filter) body.filter = filter
    const response = await this._request<{
      result?: { points?: Array<{ score: number; payload: QdrantPayload }> }
    }>("POST", `/collections/${this._cfg.collection}/points/query`, body)
    const points = response.result?.points ?? []
    return points.map((p) => ({
      chunk: {
        id: PositionAwareChunkId(p.payload.chunkId),
        content: p.payload.content,
        docId: DocumentId(p.payload.docId),
        start: p.payload.start,
        end: p.payload.end,
        metadata: p.payload.metadata ?? {}
      },
      score: p.score
    }))
  }

  async deleteByDocument(
    documentId: string,
    filter?: VectorFilter
  ): Promise<void> {
    await this._request(
      "POST",
      `/collections/${this._cfg.collection}/points/delete?wait=true`,
      { filter: buildQdrantFilter({ ...filter, documentId }) }
    )
  }

  async deleteByKnowledgeBase(
    _kbId: string,
    _filter?: VectorFilter
  ): Promise<void> {
    await this._dropCollection()
  }

  async clear(_filter?: VectorFilter): Promise<void> {
    await this._dropCollection()
  }

  async checkHealth(): Promise<boolean> {
    try {
      this._collectionEnsured = false
      await this.ensureCollection()
      return true
    } catch {
      return false
    }
  }

  private async _dropCollection(): Promise<void> {
    try {
      await this._request("DELETE", `/collections/${this._cfg.collection}`)
    } catch (err) {
      // A missing collection is the desired end-state; cleanup may be replayed.
      if (!(err instanceof QdrantHttpError && err.status === 404)) throw err
    }
    this._collectionEnsured = false
  }
}

class QdrantHttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`Qdrant API error: ${status} - ${body}`)
  }
}
