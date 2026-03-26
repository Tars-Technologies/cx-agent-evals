"use node";

import { action, ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  PositionAwareChunkId,
  DocumentId,
  type PipelineConfig,
  type PositionAwareChunk,
  type ScoredChunk,
} from "rag-evaluation-system";
import {
  BM25SearchIndex,
  weightedScoreFusion,
  reciprocalRankFusion,
} from "rag-evaluation-system/pipeline/internals";
import { createEmbedder } from "rag-evaluation-system/llm";
import { getAuthContext } from "../lib/auth";
import { vectorSearchWithFilter } from "../lib/vectorSearch";

// ─── Helpers ───

/** Paginate through all chunks for a (kbId, indexConfigHash). */
async function loadAllChunksForRetriever(
  ctx: ActionCtx,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
) {
  const all: Array<{
    chunkId: string;
    content: string;
    docId: string;
    start: number;
    end: number;
    metadata: Record<string, unknown>;
  }> = [];
  let cursor: string | null = null;
  let done = false;
  while (!done) {
    const page: any = await ctx.runQuery(
      internal.retrieval.chunks.getChunksByKbConfigPage,
      { kbId, indexConfigHash, cursor },
    );
    all.push(...page.chunks);
    done = page.isDone;
    cursor = page.continueCursor;
  }
  return all;
}

/** Deduplicate raw chunks by chunkId and convert to PositionAwareChunk-like objects. */
function deduplicateChunks(
  rawChunks: Array<{ chunkId: string; content: string; docId: string; start: number; end: number; metadata: Record<string, unknown> }>,
) {
  const seen = new Set<string>();
  const result: Array<{ id: ReturnType<typeof PositionAwareChunkId>; content: string; docId: ReturnType<typeof DocumentId>; start: number; end: number; metadata: Record<string, unknown> }> = [];
  for (const c of rawChunks) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    result.push({
      id: PositionAwareChunkId(c.chunkId),
      content: c.content,
      docId: DocumentId(c.docId),
      start: c.start,
      end: c.end,
      metadata: c.metadata,
    });
  }
  return result;
}

// ─── Create Retriever ───

/**
 * Create a retriever for a KB with a given pipeline config.
 * This is an action (not mutation) because it needs Node.js crypto for hash computation.
 * Does NOT trigger indexing — use startIndexing separately.
 * Dedup: returns existing retriever if (kbId, retrieverConfigHash) already exists.
 */
export const create = action({
  args: {
    kbId: v.id("knowledgeBases"),
    retrieverConfig: v.any(),
  },
  handler: async (ctx, args): Promise<{ retrieverId: Id<"retrievers">; existing: boolean }> => {
    const { orgId, userId } = await getAuthContext(ctx);

    const config = args.retrieverConfig as PipelineConfig & { k?: number };
    const k = config.k ?? 5;

    // Compute both hashes (requires Node crypto)
    const indexConfigHash = computeIndexConfigHash(config);
    const retrieverConfigHash = computeRetrieverConfigHash(config, k);

    // Dedup: check if retriever with same (kbId, retrieverConfigHash) exists
    const existing = await ctx.runQuery(
      internal.crud.retrievers.findByConfigHash,
      { kbId: args.kbId, retrieverConfigHash },
    );

    if (existing) {
      return { retrieverId: existing._id, existing: true };
    }

    // Look up user record
    const user = await ctx.runQuery(internal.crud.users.getByClerkId, {
      clerkId: userId,
    });
    if (!user) throw new Error("User not found");

    const name = config.name ?? `retriever-${retrieverConfigHash.slice(0, 8)}`;

    const retrieverId = await ctx.runMutation(
      internal.crud.retrievers.insertRetriever,
      {
        orgId,
        kbId: args.kbId,
        name,
        retrieverConfig: args.retrieverConfig,
        indexConfigHash,
        retrieverConfigHash,
        defaultK: k,
        status: "configuring",
        createdBy: user._id,
      },
    );

    return { retrieverId, existing: false };
  },
});

// ─── Start Indexing ───

/**
 * Start indexing for a retriever. Triggers the indexing pipeline and updates
 * the retriever status to "indexing" (or "ready" if already indexed).
 */
export const startIndexing = action({
  args: {
    retrieverId: v.id("retrievers"),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const { orgId, userId } = await getAuthContext(ctx);

    const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, {
      id: args.retrieverId,
    });

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    if (retriever.status !== "configuring" && retriever.status !== "error") {
      throw new Error(`Cannot start indexing: retriever is ${retriever.status}`);
    }

    const config = retriever.retrieverConfig as PipelineConfig & { k?: number };

    // Resolve index config for the indexing service
    const indexSettings = (config.index ?? {}) as Record<string, unknown>;
    const strategy = (indexSettings.strategy as string) ?? "plain";
    const embeddingModel =
      (indexSettings.embeddingModel as string) ?? "text-embedding-3-small";

    const indexConfig = strategy === "parent-child"
      ? {
          strategy: "parent-child" as const,
          childChunkSize: (indexSettings.childChunkSize as number) ?? 200,
          parentChunkSize: (indexSettings.parentChunkSize as number) ?? 1000,
          childOverlap: (indexSettings.childOverlap as number) ?? 0,
          parentOverlap: (indexSettings.parentOverlap as number) ?? 100,
          embeddingModel,
        }
      : {
          strategy: "plain" as const,
          chunkSize: (indexSettings.chunkSize as number) ?? 1000,
          chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
          separators: indexSettings.separators as string[] | undefined,
          embeddingModel,
        };

    // Look up user record
    const user = await ctx.runQuery(internal.crud.users.getByClerkId, {
      clerkId: userId,
    });
    if (!user) throw new Error("User not found");

    // Trigger indexing
    const indexResult = await ctx.runMutation(
      internal.retrieval.indexing.startIndexing,
      {
        orgId,
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        indexConfig,
        createdBy: user._id,
      },
    );

    // Determine status
    let status: "configuring" | "indexing" | "ready" | "error";
    let chunkCount: number | undefined;

    if (indexResult.alreadyCompleted) {
      const job = await ctx.runQuery(internal.retrieval.indexing.getJobInternal, {
        jobId: indexResult.jobId,
      });
      chunkCount = job?.totalChunks;
      status = "ready";
    } else {
      status = "indexing";
    }

    await ctx.runMutation(internal.crud.retrievers.updateIndexingStatus, {
      retrieverId: args.retrieverId,
      indexingJobId: indexResult.jobId,
      status,
      chunkCount,
    });

    return { status };
  },
});

// ─── Retrieve ───

/**
 * Standalone retrieval: given a retriever ID and query, return ranked chunks.
 * Used by the playground and future production consumers.
 */
export const retrieve = action({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
    k: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    chunkId: string;
    content: string;
    docId: string;
    start: number;
    end: number;
    score: number;
    metadata: Record<string, unknown>;
  }[]> => {
    const { orgId } = await getAuthContext(ctx);

    // Load retriever
    const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, {
      id: args.retrieverId,
    });

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`,
      );
    }

    const config = retriever.retrieverConfig as PipelineConfig & {
      k?: number;
    };
    const topK = args.k ?? retriever.defaultK;

    // Resolve embedding model and search strategy from config
    const indexSettings = (config.index ?? {}) as Record<string, unknown>;
    const embeddingModel =
      (indexSettings.embeddingModel as string) ?? "text-embedding-3-small";
    const indexStrategy = (indexSettings.strategy as string) ?? "plain";

    const searchSettings = ((config as Record<string, any>).search ?? {}) as Record<string, any>;
    const searchStrategy = (searchSettings.strategy as string) ?? "dense";

    if (searchStrategy === "bm25") {
      // BM25: load all chunks, build in-memory inverted index, search
      const rawChunks = await loadAllChunksForRetriever(ctx, retriever.kbId, retriever.indexConfigHash);
      const paChunks = deduplicateChunks(rawChunks);
      const bm25 = new BM25SearchIndex({
        k1: searchSettings.k1 as number | undefined,
        b: searchSettings.b as number | undefined,
      });
      bm25.build(paChunks);
      const results = bm25.searchWithScores(args.query, topK);
      bm25.clear();

      return [...results].map(({ chunk, score }) => ({
        chunkId: chunk.id as string,
        content: chunk.content,
        docId: chunk.docId as string,
        start: chunk.start,
        end: chunk.end,
        score,
        metadata: (chunk.metadata ?? {}) as Record<string, unknown>,
      }));
    } else if (searchStrategy === "hybrid") {
      // Hybrid: BM25 in-memory + Convex vector search, fused
      const rawChunks = await loadAllChunksForRetriever(ctx, retriever.kbId, retriever.indexConfigHash);
      const paChunks = deduplicateChunks(rawChunks);
      const bm25 = new BM25SearchIndex({
        k1: searchSettings.k1 as number | undefined,
        b: searchSettings.b as number | undefined,
      });
      bm25.build(paChunks);

      const candidateMultiplier = (searchSettings.candidateMultiplier as number) ?? 4;
      const denseWeight = (searchSettings.denseWeight as number) ?? 0.7;
      const sparseWeight = (searchSettings.sparseWeight as number) ?? 0.3;
      const candidateK = topK * candidateMultiplier;

      // Dense component
      const embedder = createEmbedder(embeddingModel);
      const queryEmbedding = await embedder.embedQuery(args.query);
      const { chunks: denseRaw, scoreMap } = await vectorSearchWithFilter(ctx, {
        queryEmbedding,
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        topK: candidateK,
        indexStrategy,
      });
      const denseResults: ScoredChunk[] = denseRaw.map((c: any) => ({
        chunk: {
          id: PositionAwareChunkId(c.chunkId),
          content: c.content,
          docId: DocumentId(c.docId),
          start: c.start,
          end: c.end,
          metadata: c.metadata ?? {},
        },
        score: scoreMap.get(c._id.toString()) ?? 0,
      }));

      // Sparse component
      const sparseResults: ScoredChunk[] = [...bm25.searchWithScores(args.query, candidateK)];
      bm25.clear();

      // Fuse
      const fusionMethod = (searchSettings.fusionMethod as string) ?? "weighted";
      const fused =
        fusionMethod === "rrf"
          ? reciprocalRankFusion({ denseResults, sparseResults, k: searchSettings.rrfK as number | undefined })
          : weightedScoreFusion({ denseResults, sparseResults, denseWeight, sparseWeight });

      return fused.slice(0, topK).map(({ chunk, score }) => ({
        chunkId: chunk.id as string,
        content: chunk.content,
        docId: chunk.docId as string,
        start: chunk.start,
        end: chunk.end,
        score,
        metadata: (chunk.metadata ?? {}) as Record<string, unknown>,
      }));
    } else {
      // Dense (default): embed query → Convex vector search
      const embedder = createEmbedder(embeddingModel);
      const queryEmbedding = await embedder.embedQuery(args.query);

      const { chunks: filtered, scoreMap } = await vectorSearchWithFilter(ctx, {
        queryEmbedding,
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        topK,
        indexStrategy,
      });

      return filtered.map((c: any) => ({
        chunkId: c.chunkId,
        content: c.content,
        docId: c.docId,
        start: c.start,
        end: c.end,
        score: scoreMap.get(c._id.toString()) ?? 0,
        metadata: c.metadata ?? {},
      }));
    }
  },
});
