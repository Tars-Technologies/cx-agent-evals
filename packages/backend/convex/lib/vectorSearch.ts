import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Execute vector search with post-filtering by indexConfigHash.
 * Shared by retrieverActions.retrieve and experimentActions.runEvaluation.
 *
 * Over-fetches by 2x (max 64) to compensate for post-filtering,
 * since Convex vector search filters by both kbId and indexConfigHash at index level.
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
  const overFetch = Math.min(opts.topK * 2, 64);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) =>
      q.and(
        q.eq("kbId", opts.kbId),
        q.eq("indexConfigHash", opts.indexConfigHash),
      ),
  });

  const chunks: any[] = await ctx.runQuery(
    internal.retrieval.chunks.fetchChunksWithDocs,
    { ids: results.map((r: any) => r._id) },
  );

  // Build score map for callers that need it (e.g., retrieverActions.retrieve)
  const scoreMap = new Map<string, number>();
  for (const r of results) {
    scoreMap.set(r._id.toString(), r._score);
  }

  // Post-filter by indexConfigHash and take topK
  let filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK);

  // Parent-child swap: replace child chunks with their parent chunks
  if (opts.indexStrategy === "parent-child") {
    const parentIdsSeen = new Set<string>();
    const swapped: any[] = [];

    for (const child of filtered) {
      const parentId = child.metadata?.parentChunkId;
      if (parentId && !parentIdsSeen.has(parentId)) {
        parentIdsSeen.add(parentId);
        const parent = await ctx.runQuery(
          internal.retrieval.chunks.getChunkById,
          { chunkId: parentId },
        );
        if (parent) {
          const childScore = scoreMap.get(child._id.toString()) ?? 0;
          // Update scoreMap so callers can look up score by parent ID
          scoreMap.set(parent._id.toString(), childScore);
          swapped.push({
            ...parent,
            _score: childScore,
          });
        } else {
          swapped.push(child); // Fallback if parent not found
        }
      } else if (!parentId) {
        swapped.push(child); // Not a child chunk, keep as-is
      }
      // Skip if parent already added (deduplication)
    }
    filtered = swapped;
  }

  return { chunks: filtered, scoreMap };
}
