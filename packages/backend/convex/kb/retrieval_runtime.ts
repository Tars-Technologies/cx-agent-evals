"use node"

/**
 * Shared retrieval runtime builders: the eval-lib VectorStore seam over
 * Convex-native vector search. Carries "use node" because it imports the
 * eval-lib main barrel, whose transitive graph reaches Node-only built-ins
 * (crypto, fs/promises). Imported ONLY by "use node" action files
 * (retrieve_actions, experiment_actions, pipeline_actions); it registers no
 * Convex functions, only plain helpers.
 */
import {
  CallbackVectorStore,
  DocumentId,
  PositionAwareChunkId,
  type VectorSearchResult,
  type VectorStore
} from "@tars-inc/eval-lib"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { vectorSearchWithFilter } from "../lib/vectorSearch"

/** Convert raw Convex chunk rows + the vector-search score map to results. */
export function rawChunksToResults(
  rows: ReadonlyArray<{
    _id: unknown
    chunkId: string
    content: string
    docId: string
    start: number
    end: number
    metadata?: Record<string, unknown>
  }>,
  scoreMap: ReadonlyMap<string, number>
): VectorSearchResult[] {
  return rows.map((c) => ({
    chunk: {
      id: PositionAwareChunkId(c.chunkId),
      content: c.content,
      docId: DocumentId(c.docId),
      start: c.start,
      end: c.end,
      metadata: c.metadata ?? {}
    },
    score: scoreMap.get(String(c._id)) ?? 0
  }))
}

export interface NativeVectorStoreOpts {
  readonly kbId: Id<"knowledgeBases">
  readonly indexConfigHash: string
  /** "plain" | "parent-child" - drives the parent swap inside native search. */
  readonly indexStrategy?: string
}

/**
 * Native Convex VectorStore: search wraps vectorSearchWithFilter (including
 * its indexConfigHash post-filter and parent-child swap); deletes wrap the
 * existing chunk mutations. `add` is intentionally NOT provided - ingestion
 * stays on the two-phase indexing mutations.
 */
export function buildNativeVectorStore(
  ctx: ActionCtx,
  opts: NativeVectorStoreOpts
): VectorStore {
  return new CallbackVectorStore({
    name: "convex-native",
    search: async (queryEmbedding, searchOpts) => {
      const { chunks, scoreMap } = await vectorSearchWithFilter(ctx, {
        queryEmbedding: [...queryEmbedding],
        kbId: opts.kbId,
        indexConfigHash: opts.indexConfigHash,
        topK: searchOpts.k,
        indexStrategy: opts.indexStrategy
      })
      return rawChunksToResults(chunks, scoreMap)
    }
  })
}
