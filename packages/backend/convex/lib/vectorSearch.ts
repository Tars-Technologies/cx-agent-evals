import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

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
    queryEmbedding: number[];
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    topK: number;
    indexStrategy?: string; // "plain" | "parent-child"
  },
) {
  const overFetch = Math.min(opts.topK * 4, 128);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) => q.eq("kbId", opts.kbId),
  });

  // Phase 1: hydrate chunks only (no document records — those are heavy).
  const chunks: any[] = await ctx.runQuery(
    internal.retrieval.chunks.fetchChunksByIds,
    { ids: results.map((r: any) => r._id) },
  );

  const scoreMap = new Map<string, number>();
  for (const r of results) {
    scoreMap.set(r._id.toString(), r._score);
  }

  // Post-filter by indexConfigHash and take topK before any heavy hydration.
  let filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK);

  // Parent-child swap: batch-fetch all parents in a single query.
  if (opts.indexStrategy === "parent-child") {
    const parentIds = [
      ...new Set(
        filtered
          .map((c: any) => c.metadata?.parentChunkId)
          .filter(Boolean),
      ),
    ] as Id<"documentChunks">[];

    const parents: any[] = parentIds.length > 0
      ? await ctx.runQuery(
          internal.retrieval.chunks.fetchChunksByIds,
          { ids: parentIds },
        )
      : [];
    const parentMap = new Map<string, any>(
      parents.map((p) => [p._id.toString(), p]),
    );

    const parentIdsSeen = new Set<string>();
    const swapped: any[] = [];
    for (const child of filtered) {
      const parentId = child.metadata?.parentChunkId;
      if (parentId && !parentIdsSeen.has(parentId)) {
        parentIdsSeen.add(parentId);
        const parent = parentMap.get(parentId);
        if (parent) {
          const childScore = scoreMap.get(child._id.toString()) ?? 0;
          scoreMap.set(parent._id.toString(), childScore);
          swapped.push({ ...parent, _score: childScore });
        } else {
          swapped.push(child); // Fallback if parent not found
        }
      } else if (!parentId) {
        swapped.push(child);
      }
      // Skip if parent already added (deduplication)
    }
    filtered = swapped;
  }

  // Phase 2: hydrate docId only for the topK survivors, deduplicated.
  const seenDocs = new Set<string>();
  const uniqueDocumentIds: Id<"documents">[] = [];
  for (const c of filtered) {
    const key = c.documentId.toString();
    if (!seenDocs.has(key)) {
      seenDocs.add(key);
      uniqueDocumentIds.push(c.documentId);
    }
  }

  const docIdMap: Record<string, string> = uniqueDocumentIds.length > 0
    ? await ctx.runQuery(internal.retrieval.chunks.fetchDocIdMap, {
        documentIds: uniqueDocumentIds,
      })
    : {};

  filtered = filtered.map((c: any) => ({
    ...c,
    docId: docIdMap[c.documentId.toString()] ?? "",
  }));

  return { chunks: filtered, scoreMap };
}
