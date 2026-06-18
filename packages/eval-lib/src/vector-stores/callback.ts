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
  private readonly _cfg: CallbackVectorStoreConfig

  constructor(config: CallbackVectorStoreConfig) {
    this.name = config.name
    this._cfg = config
  }

  private _unsupported(method: string): never {
    throw new Error(`${this.name} does not support ${method}`)
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
