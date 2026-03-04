import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Execute vector search with post-filtering by indexConfigHash.
 * Shared by retrieverActions.retrieve and experimentActions.runEvaluation.
 *
 * Over-fetches by 4x (max 256) to compensate for post-filtering,
 * since Convex vector search only supports filtering by kbId directly.
 */
export async function vectorSearchWithFilter(
  ctx: ActionCtx,
  opts: {
    queryEmbedding: number[];
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    topK: number;
  },
) {
  const overFetch = Math.min(opts.topK * 4, 256);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) => q.eq("kbId", opts.kbId),
  });

  const chunks: any[] = await ctx.runQuery(
    internal.retrieval.chunks.fetchChunksWithDocs,
    { ids: results.map((r: any) => r._id) },
  );

  // Post-filter by indexConfigHash and take topK
  const filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK);

  // Build score map for callers that need it (e.g., retrieverActions.retrieve)
  const scoreMap = new Map<string, number>();
  for (const r of results) {
    scoreMap.set(r._id.toString(), r._score);
  }

  return { chunks: filtered, scoreMap };
}
