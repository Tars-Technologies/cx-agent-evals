import { createHash } from "node:crypto"
import type { Schemas } from "@qdrant/js-client-rest"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../types/index.js"
import { HttpError, requestJSON } from "../utils/fetch-json.js"
import type { Bm25DocParams } from "./sparse/bm25-encoder.js"
import { encodeDocument, encodeQuery } from "./sparse/bm25-encoder.js"
import type {
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from "./vector-store.interface.js"

/**
 * Create-time collection tuning, applied only when the collection is first
 * created. Omitted fields keep their production defaults, so a bare store is
 * born hardened; a consumer overrides only what it wants to experiment with.
 */
export interface QdrantCollectionTuning {
  /** Store vectors on disk instead of RAM. Default true. */
  readonly onDisk?: boolean
  /** Store payloads on disk instead of RAM. Default true. */
  readonly onDiskPayload?: boolean
  /**
   * HNSW params. Default `{ m: 0, payloadM: 16 }` builds per-tenant subgraphs
   * (no global graph), so every search must filter on the tenant key (`kbId`).
   * A single-tenant consumer that searches unfiltered must set `m` > 0.
   */
  readonly hnsw?: { readonly m?: number; readonly payloadM?: number }
  /**
   * Scalar quantization. Default `{ type: "int8", alwaysRam: true }`. Pass
   * `false` for full-precision vectors with no quantization.
   */
  readonly quantization?:
    | false
    | { readonly type?: "int8"; readonly alwaysRam?: boolean }
}

export interface QdrantVectorStoreConfig {
  /** Base URL including port, e.g. https://xyz.cloud.qdrant.io:6333 */
  readonly url: string
  /** API key sent as the `api-key` header. Optional for unsecured local instances. */
  readonly apiKey?: string
  /** Collection name; the caller chooses the partitioning scheme. */
  readonly collection: string
  /** Vector dimension; the collection is created/validated against it. */
  readonly dimension: number
  readonly retry?: { readonly maxRetries?: number; readonly backoffMs?: number }
  /** Per-request timeout in ms; aborts a hung fetch so withRetry can retry. Default 30000. */
  readonly timeoutMs?: number
  /** Create-time collection tuning; defaults to a hardened multi-tenant config. */
  readonly tuning?: QdrantCollectionTuning
  /**
   * When true, the collection is a **named hybrid**: a `dense` vector plus a
   * co-located `bm25` sparse vector (server-side IDF) on the same point, and
   * `searchSparse` runs real keyword search. When false (default), the store
   * keeps its historical **single unnamed dense** shape byte-for-byte and
   * `searchSparse` no-ops to `[]`. The two collection shapes are incompatible,
   * so this is fixed per collection at create time.
   */
  readonly sparse?: boolean
  /**
   * BM25 weighting baked into stored document sparse values (only consulted
   * when `sparse` is true). Defaults match eval-lib's `BM25SearchIndex`
   * (`k1 = 1.2`, `b = 0.75`), so a `k1`/`b` config means the same across the
   * sparse vector and the in-memory MiniSearch fallback.
   */
  readonly bm25?: Bm25DocParams
}

export interface QdrantPointScope {
  readonly kbId: string
  readonly indexConfigHash: string
  readonly documentId: string
}

/**
 * Deterministic UUID-format point id scoped to the shared collection partition.
 * Payload filters enforce read isolation, while the scoped primary key prevents
 * one tenant or index configuration from overwriting another tenant's point.
 */
export function qdrantPointId(
  chunkId: string,
  scope: QdrantPointScope
): string {
  const identity = JSON.stringify([
    scope.kbId,
    scope.indexConfigHash,
    scope.documentId,
    chunkId
  ])
  const h = createHash("sha256").update(identity).digest("hex")
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

function buildQdrantFilter(
  filter?: VectorFilter
): Schemas["Filter"] | undefined {
  if (!filter) return undefined
  const must: Schemas["Condition"][] = []
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
  /** True only when built as a named hybrid (`sparse: true`). */
  readonly supportsSparse: boolean
  private readonly _cfg: QdrantVectorStoreConfig
  private readonly _sparse: boolean
  private readonly _bm25: Bm25DocParams
  private _collectionEnsured = false

  constructor(config: QdrantVectorStoreConfig) {
    let endpoint: URL
    try {
      endpoint = new URL(config.url)
    } catch {
      throw new Error("QdrantVectorStore: url must be a valid HTTPS URL")
    }
    if (endpoint.protocol !== "https:") {
      throw new Error("QdrantVectorStore: url must use HTTPS")
    }
    this._cfg = config
    this._sparse = config.sparse ?? false
    this.supportsSparse = this._sparse
    this._bm25 = config.bm25 ?? {}
  }

  private async _request<T>(
    method: "GET" | "PUT" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    retryOverride?: QdrantVectorStoreConfig["retry"]
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (this._cfg.apiKey) headers["api-key"] = this._cfg.apiKey
    // Shared HTTP core: the default retry policy already fails fast on
    // non-retryable 4xx (a bad api-key or malformed query) and retries only
    // transient failures. QdrantHttpError carries the status it keys on.
    return requestJSON<T>({
      url: `${this._cfg.url}${path}`,
      method,
      body,
      headers,
      provider: "Qdrant",
      retry: retryOverride ?? this._cfg.retry,
      timeoutMs: this._cfg.timeoutMs ?? 30_000,
      // Qdrant never redirects; refuse to follow one so the api-key header
      // (which fetch does NOT strip on cross-origin redirects, unlike
      // Authorization) cannot leak to a redirect target.
      redirect: "error",
      errorFactory: (status, _statusText, text) =>
        new QdrantHttpError(status, text)
    })
  }

  /**
   * Build the create-collection body, merging `tuning` over the hardened
   * defaults. Distance/size stay fixed (Cosine, configured dimension): both are
   * immutable in Qdrant, so they are not tunable knobs.
   */
  private _createCollectionBody(): Schemas["CreateCollection"] {
    const tuning = this._cfg.tuning ?? {}
    const onDisk = tuning.onDisk ?? true
    const onDiskPayload = tuning.onDiskPayload ?? true
    const m = tuning.hnsw?.m ?? 0
    const payloadM = tuning.hnsw?.payloadM ?? 16

    if (this._sparse) {
      return this._createSparseCollectionBody({
        onDisk,
        onDiskPayload,
        m,
        payloadM
      })
    }

    const body: Schemas["CreateCollection"] = {
      vectors: {
        size: this._cfg.dimension,
        distance: "Cosine",
        on_disk: onDisk
      },
      on_disk_payload: onDiskPayload,
      hnsw_config: { m, payload_m: payloadM }
    }

    // `false` disables quantization entirely (full-precision vectors); omit the
    // key rather than sending null.
    if (tuning.quantization !== false) {
      const quant = tuning.quantization ?? {}
      body.quantization_config = {
        scalar: {
          type: quant.type ?? "int8",
          always_ram: quant.alwaysRam ?? true
        }
      }
    }
    return body
  }

  /**
   * Named-hybrid create body: the dense vector moves under the `dense` key and
   * a BM25 sparse vector is declared under `bm25` with server-side IDF. The
   * dense vector keeps the same hardening (on-disk + scalar quantization) as the
   * unnamed path; named vectors carry quantization per-vector.
   */
  private _createSparseCollectionBody(opts: {
    onDisk: boolean
    onDiskPayload: boolean
    m: number
    payloadM: number
  }): Schemas["CreateCollection"] {
    const tuning = this._cfg.tuning ?? {}
    const dense: Schemas["VectorParams"] = {
      size: this._cfg.dimension,
      distance: "Cosine",
      on_disk: opts.onDisk
    }
    if (tuning.quantization !== false) {
      const quant = tuning.quantization ?? {}
      dense.quantization_config = {
        scalar: {
          type: quant.type ?? "int8",
          always_ram: quant.alwaysRam ?? true
        }
      }
    }
    return {
      vectors: { dense },
      // Keep the sparse index on disk too, matching the dense vector's hardening.
      sparse_vectors: {
        bm25: { modifier: "idf", index: { on_disk: opts.onDisk } }
      },
      on_disk_payload: opts.onDiskPayload,
      hnsw_config: { m: opts.m, payload_m: opts.payloadM }
    }
  }

  /** Create the collection if absent; throw on dimension mismatch. */
  async ensureCollection(): Promise<void> {
    if (this._collectionEnsured) return
    try {
      await this._verifyCollectionDimension()
    } catch (err) {
      if (err instanceof QdrantHttpError && err.status === 404) {
        try {
          await this._request(
            "PUT",
            `/collections/${this._cfg.collection}`,
            this._createCollectionBody()
          )
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
      // The kbId index is the tenant key in the shared collection: marking it
      // `is_tenant` lets Qdrant co-locate a tenant's points on disk.
      const fieldSchema =
        field === "kbId" ? { type: "keyword", is_tenant: true } : "keyword"
      try {
        await this._request(
          "PUT",
          `/collections/${this._cfg.collection}/index?wait=true`,
          { field_name: field, field_schema: fieldSchema }
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
      result?: Schemas["CollectionInfo"]
    }>("GET", `/collections/${this._cfg.collection}`, undefined, {
      maxRetries: 0
    })
    const vectors = info.result?.config?.params?.vectors
    // Sparse stores read the dimension from the named `dense` vector; the
    // unnamed dense store reads the top-level size. Each rejects the other's
    // shape (size === undefined), so a store can never address a collection
    // built in the wrong shape.
    const size = this._sparse
      ? typeof vectors === "object" &&
        vectors !== null &&
        "dense" in vectors &&
        typeof vectors.dense === "object" &&
        vectors.dense !== null
        ? vectors.dense.size
        : undefined
      : typeof vectors === "object" &&
          vectors !== null &&
          typeof vectors.size === "number"
        ? vectors.size
        : undefined
    if (size === undefined) {
      throw new Error(
        this._sparse
          ? `Qdrant collection "${this._cfg.collection}" reported no named "dense" vector size (expected a sparse/named-hybrid collection); refusing to use it`
          : `Qdrant collection "${this._cfg.collection}" reported no vector size (unexpected shape, e.g. named vectors); refusing to use it`
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
    const kbId = scope?.kbId
    const indexConfigHash = scope?.indexConfigHash
    const documentId = scope?.documentId
    if (!kbId || !indexConfigHash || !documentId) {
      throw new Error(
        "QdrantVectorStore.add requires kbId, indexConfigHash, and documentId"
      )
    }
    await this.ensureCollection()
    const points = chunks.map((chunk, i) => {
      const id = qdrantPointId(String(chunk.id), {
        kbId,
        indexConfigHash,
        documentId
      })
      const payload = {
        chunkId: String(chunk.id),
        content: chunk.content,
        docId: String(chunk.docId),
        start: chunk.start,
        end: chunk.end,
        metadata: chunk.metadata ?? {},
        kbId,
        indexConfigHash,
        documentId
      } satisfies QdrantPayload
      if (this._sparse) {
        // Named hybrid: dense + a BM25 sparse vector encoded from the chunk text
        // are upserted on the same point, so they can never drift apart.
        const sparse = encodeDocument(chunk.content, this._bm25)
        return {
          id,
          vector: {
            dense: embeddings[i],
            bm25: { indices: sparse.indices, values: sparse.values }
          },
          payload
        }
      }
      return { id, vector: embeddings[i], payload }
    })
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
    // Fail closed on the shared collection, symmetric with add()/clear(): every
    // read MUST be scoped to a tenant. Without kbId the query would run against
    // every co-tenant's vectors (the hardened m=0 default also leaves no graph
    // to traverse), so refuse rather than silently issue an unscoped query.
    if (!opts.filter?.kbId) {
      throw new Error(
        "QdrantVectorStore.search: refusing to query the shared collection " +
          "without a tenant scope; pass filter.kbId"
      )
    }
    const body: Schemas["QueryRequest"] = {
      query: [...queryEmbedding],
      limit: opts.k,
      with_payload: true
    }
    // Named-hybrid collections require the vector name; unnamed collections must
    // not send `using` (there is no named vector to target).
    if (this._sparse) body.using = "dense"
    const filter = buildQdrantFilter(opts.filter)
    if (filter) body.filter = filter
    return this._queryPoints(body)
  }

  /**
   * Keyword search over the co-located BM25 sparse vector. No-ops to `[]` on an
   * unnamed-dense store (no sparse vector exists). Encodes the query with the
   * same tokenizer/hash used at `add` time and runs Qdrant's sparse Query API
   * (`using: "bm25"`), with IDF applied server-side via the collection's
   * `modifier: "idf"`.
   */
  async searchSparse(
    query: string,
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    if (!this._sparse) return []
    // Symmetric with search()/add(): every read on the shared collection must be
    // tenant-scoped, or it would query across co-tenants.
    if (!opts.filter?.kbId) {
      throw new Error(
        "QdrantVectorStore.searchSparse: refusing to query the shared collection " +
          "without a tenant scope; pass filter.kbId"
      )
    }
    const sparse = encodeQuery(query)
    // A query of only stopwords/punctuation has no terms; Qdrant rejects an
    // empty sparse query and there is nothing to match anyway.
    if (sparse.indices.length === 0) return []
    const body: Schemas["QueryRequest"] = {
      query: { indices: sparse.indices, values: sparse.values },
      using: "bm25",
      limit: opts.k,
      with_payload: true
    }
    const filter = buildQdrantFilter(opts.filter)
    if (filter) body.filter = filter
    return this._queryPoints(body)
  }

  /** Issue a points/query, tolerating an unprovisioned collection (404 → []). */
  private async _queryPoints(
    body: Schemas["QueryRequest"]
  ): Promise<VectorSearchResult[]> {
    let response: {
      result?: {
        points?: Array<Schemas["ScoredPoint"] & { payload: QdrantPayload }>
      }
    }
    try {
      response = await this._request(
        "POST",
        `/collections/${this._cfg.collection}/points/query`,
        body
      )
    } catch (err) {
      // Store parity with the native/in-memory backends: an unprovisioned
      // collection (404) means "no results yet", not a hard failure.
      if (err instanceof QdrantHttpError && err.status === 404) return []
      throw err
    }
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
    kbId: string,
    filter?: VectorFilter
  ): Promise<void> {
    // Shared-collection safe: delete only this kbId's points by payload filter
    // instead of dropping the whole collection (which would wipe every tenant).
    try {
      await this._request(
        "POST",
        `/collections/${this._cfg.collection}/points/delete?wait=true`,
        { filter: buildQdrantFilter({ ...filter, kbId }) }
      )
    } catch (err) {
      // A missing collection is the desired end-state; cleanup may be replayed
      // against a collection that was never created.
      if (!(err instanceof QdrantHttpError && err.status === 404)) throw err
    }
  }

  /**
   * Deletes only the points matching `filter` (a scoped reset within the shared
   * collection). The collection is partitioned across tenants by payload
   * (`kbId`, `indexConfigHash`, `documentId`), so it has no safe wholesale
   * clear: an unscoped call would wipe every co-tenant's vectors. Calling this
   * without a scoping filter therefore throws; use `deleteByKnowledgeBase` /
   * `deleteByDocument`, or pass an explicit filter, to scope the delete.
   */
  async clear(filter?: VectorFilter): Promise<void> {
    if (!filter || !Object.values(filter).some((v) => v !== undefined)) {
      throw new Error(
        "QdrantVectorStore.clear: refusing to clear the entire shared collection; " +
          "pass a scope filter (e.g. { kbId }) or use deleteByKnowledgeBase/deleteByDocument"
      )
    }
    await this._request(
      "POST",
      `/collections/${this._cfg.collection}/points/delete?wait=true`,
      { filter: buildQdrantFilter(filter) }
    )
  }

  async checkHealth(): Promise<boolean> {
    // Passive liveness probe: a non-provisioning GET of the collection. A
    // health check must never resurrect a dropped collection, so this does
    // NOT fall through to ensureCollection() (which creates on a 404).
    try {
      await this._request(
        "GET",
        `/collections/${this._cfg.collection}`,
        undefined,
        { maxRetries: 0 }
      )
      return true
    } catch {
      return false
    }
  }
}

class QdrantHttpError extends HttpError {
  constructor(status: number, body: string) {
    super(status, `Qdrant API error: ${status} - ${body}`)
  }
}
