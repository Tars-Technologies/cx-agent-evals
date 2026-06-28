import type { PositionAwareChunk } from "../types/index.js"
import { cosineSimilarity } from "../utils/similarity.js"
import type {
  VectorFilter,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from "./vector-store.interface.js"

interface StoredEntry {
  readonly chunk: PositionAwareChunk
  readonly embedding: number[]
  readonly scope?: VectorFilter
}

function matchesFilter(entry: StoredEntry, filter?: VectorFilter): boolean {
  if (!filter) return true
  for (const field of ["kbId", "indexConfigHash", "documentId"] as const) {
    const wanted = filter[field]
    if (wanted !== undefined && entry.scope?.[field] !== wanted) return false
  }
  return true
}

export class InMemoryVectorStore implements VectorStore {
  readonly name = "in-memory"
  // Dense-only store: no co-located sparse index, so keyword routing falls back
  // to the retriever's MiniSearch path.
  readonly supportsSparse = false
  private _entries = new Map<string, StoredEntry>()

  async searchSparse(): Promise<VectorSearchResult[]> {
    return []
  }

  async add(
    chunks: readonly PositionAwareChunk[],
    embeddings: readonly number[][],
    scope?: VectorFilter
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error(
        `InMemoryVectorStore.add: ${chunks.length} chunks but ${embeddings.length} embeddings`
      )
    }
    chunks.forEach((chunk, i) => {
      this._entries.set(String(chunk.id), {
        chunk,
        embedding: [...embeddings[i]],
        scope
      })
    })
  }

  async search(
    queryEmbedding: readonly number[],
    opts: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const scored: VectorSearchResult[] = []
    for (const entry of this._entries.values()) {
      if (!matchesFilter(entry, opts.filter)) continue
      scored.push({
        chunk: entry.chunk,
        score: cosineSimilarity(queryEmbedding, entry.embedding)
      })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, opts.k)
  }

  async deleteByDocument(
    documentId: string,
    filter?: VectorFilter
  ): Promise<void> {
    this._deleteWhere({ ...filter, documentId })
  }

  async deleteByKnowledgeBase(
    kbId: string,
    filter?: VectorFilter
  ): Promise<void> {
    this._deleteWhere({ ...filter, kbId })
  }

  async clear(filter?: VectorFilter): Promise<void> {
    if (!filter) {
      this._entries.clear()
      return
    }
    this._deleteWhere(filter)
  }

  async checkHealth(): Promise<boolean> {
    return true
  }

  private _deleteWhere(filter: VectorFilter): void {
    for (const [key, entry] of this._entries) {
      if (matchesFilter(entry, filter)) this._entries.delete(key)
    }
  }
}
