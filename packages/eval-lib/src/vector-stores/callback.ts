import type {
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from "./vector-store.interface.js"

/**
 * Closure-backed VectorStore. The host application (e.g. the Convex backend)
 * supplies the capabilities it can execute; anything not supplied throws.
 * `search` is the only required capability.
 */
export interface CallbackVectorStoreConfig {
  readonly name: string
  readonly search: (
    queryEmbedding: readonly number[],
    opts: VectorSearchOptions
  ) => Promise<VectorSearchResult[]>
  /**
   * Optional keyword search. When supplied (and `supportsSparse` is not set
   * false), the host store advertises sparse support and the retriever routes
   * `bm25`/`hybrid` here. When omitted, the store is dense-only and
   * `searchSparse` no-ops to `[]`.
   */
  readonly searchSparse?: (
    query: string,
    opts: VectorSearchOptions
  ) => Promise<VectorSearchResult[]>
  /**
   * Whether this host store maintains a sparse index. Defaults to whether a
   * `searchSparse` callback was supplied, so a host only has to pass the
   * callback. Set explicitly to override (e.g. force false).
   */
  readonly supportsSparse?: boolean
  readonly add?: VectorStore["add"]
  readonly deleteByDocument?: (
    documentId: string,
    filter?: VectorFilter
  ) => Promise<void>
  readonly deleteByKnowledgeBase?: (
    kbId: string,
    filter?: VectorFilter
  ) => Promise<void>
  readonly clear?: (filter?: VectorFilter) => Promise<void>
  readonly checkHealth?: () => Promise<boolean>
}

export class CallbackVectorStore implements VectorStore {
  readonly name: string
  // Sparse support is opt-in: a host that can serve keyword search (e.g. a
  // wrapper over a sparse Qdrant store) supplies a `searchSparse` callback;
  // otherwise the store is dense-only and the retriever uses its MiniSearch
  // fallback.
  readonly supportsSparse: boolean
  private readonly _cfg: CallbackVectorStoreConfig

  constructor(config: CallbackVectorStoreConfig) {
    this.name = config.name
    this._cfg = config
    if (config.supportsSparse === true && !config.searchSparse) {
      throw new Error(
        `${config.name} cannot set supportsSparse=true without a searchSparse callback`
      )
    }
    this.supportsSparse =
      config.supportsSparse ?? config.searchSparse !== undefined
  }

  private _unsupported(method: string): never {
    throw new Error(`${this.name} does not support ${method}`)
  }

  async searchSparse(
    query: string,
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    if (!this.supportsSparse || !this._cfg.searchSparse) return []
    return this._cfg.searchSparse(query, opts)
  }

  async add(
    chunks: Parameters<VectorStore["add"]>[0],
    embeddings: Parameters<VectorStore["add"]>[1],
    scope?: VectorFilter
  ): Promise<void> {
    if (!this._cfg.add) this._unsupported("add")
    return this._cfg.add(chunks, embeddings, scope)
  }

  async search(
    queryEmbedding: readonly number[],
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    return this._cfg.search(queryEmbedding, opts)
  }

  async deleteByDocument(
    documentId: string,
    filter?: VectorFilter
  ): Promise<void> {
    if (!this._cfg.deleteByDocument) this._unsupported("deleteByDocument")
    return this._cfg.deleteByDocument(documentId, filter)
  }

  async deleteByKnowledgeBase(
    kbId: string,
    filter?: VectorFilter
  ): Promise<void> {
    if (!this._cfg.deleteByKnowledgeBase)
      this._unsupported("deleteByKnowledgeBase")
    return this._cfg.deleteByKnowledgeBase(kbId, filter)
  }

  async clear(filter?: VectorFilter): Promise<void> {
    if (!this._cfg.clear) this._unsupported("clear")
    return this._cfg.clear(filter)
  }

  async checkHealth(): Promise<boolean> {
    if (!this._cfg.checkHealth) return true
    return this._cfg.checkHealth()
  }
}
