import { parentSwap } from "@tars-inc/eval-lib/utils"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"

/**
 * Execute vector search with post-filtering by indexConfigHash.
 * Shared by retrieverActions.retrieve and experimentActions.runEvaluation.
 *
 * Convex vector search filters only support q.eq and q.or (no q.and across
 * different fields), so we filter by kbId at the index level and post-filter
 * indexConfigHash in JS. Over-fetches 4x with a 128-chunk cap to keep worst-
 * case hydration well under Convex's 16 MB read limit.
 */
export async function vectorSearchWithFilter(
  ctx: ActionCtx,
  opts: {
    queryEmbedding: number[]
    kbId: Id<"knowledgeBases">
    indexConfigHash: string
    topK: number
    indexStrategy?: string // "plain" | "parent-child"
  }
) {
  const overFetch = Math.min(opts.topK * 4, 128)

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) => q.eq("kbId", opts.kbId)
  })

  // Phase 1: hydrate chunks only (no document records — those are heavy).
  const chunks: any[] = await ctx.runQuery(
    internal.kb.chunks.fetchChunksByIds,
    { ids: results.map((r: any) => r._id), kbId: opts.kbId }
  )

  const scoreMap = new Map<string, number>()
  for (const r of results) {
    scoreMap.set(r._id.toString(), r._score)
  }

  // Post-filter by indexConfigHash and take topK before any heavy hydration.
  let filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK)

  // Parent-child swap: batch-fetch all parents in a single query.
  if (opts.indexStrategy === "parent-child") {
    const parentIds = [
      ...new Set(
        filtered.map((c: any) => c.metadata?.parentChunkId).filter(Boolean)
      )
    ] as Id<"documentChunks">[]

    const parents: any[] =
      parentIds.length > 0
        ? await ctx.runQuery(internal.kb.chunks.fetchChunksByIds, {
            ids: parentIds,
            kbId: opts.kbId
          })
        : []
    const parentMap = new Map<string, any>(
      parents.map((p) => [p._id.toString(), p])
    )

    filtered = parentSwap<any, any, any>(filtered, {
      getParentId: (child) => child.metadata?.parentChunkId,
      getParent: (parentId) => parentMap.get(parentId),
      fromParent: (parent, child) => {
        // Carry the first-seen child's score onto the parent so downstream
        // _score lookups (and the returned scoreMap) resolve the parent row.
        const childScore = scoreMap.get(child._id.toString()) ?? 0
        scoreMap.set(parent._id.toString(), childScore)
        return { ...parent, _score: childScore }
      },
      keepChild: (child) => child // no parent / parent not found
    })
  }

  // Phase 2: hydrate docId only for the topK survivors, deduplicated.
  const seenDocs = new Set<string>()
  const uniqueDocumentIds: Id<"documents">[] = []
  for (const c of filtered) {
    const key = c.documentId.toString()
    if (!seenDocs.has(key)) {
      seenDocs.add(key)
      uniqueDocumentIds.push(c.documentId)
    }
  }

  const docIdMap: Record<string, string> =
    uniqueDocumentIds.length > 0
      ? await ctx.runQuery(internal.kb.chunks.fetchDocIdMap, {
          documentIds: uniqueDocumentIds
        })
      : {}

  filtered = filtered.map((c: any) => ({
    ...c,
    docId: docIdMap[c.documentId.toString()] ?? ""
  }))

  return { chunks: filtered, scoreMap }
}
