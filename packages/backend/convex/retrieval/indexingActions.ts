"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  RecursiveCharacterChunker,
  createDocument,
} from "rag-evaluation-system";
import { EMBED_BATCH_SIZE, CLEANUP_BATCH_SIZE } from "rag-evaluation-system/shared";
import { createEmbedder } from "rag-evaluation-system/llm";

/** Retry a mutation that may fail with TooManyWrites under concurrent load. */
async function retryOnWriteLimit<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : String(err);
      if (attempt < maxRetries && msg.includes("TooManyWrites")) {
        // Exponential backoff: 500ms, 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
}

// ─── Two-Phase Document Indexing Action ───

/**
 * Process a single document in two phases:
 * Phase A: Chunk and store without embeddings (atomic, pure compute)
 * Phase B: Embed in batches and patch embeddings (resumable checkpoint)
 *
 * Dispatched by WorkPool — one action per document.
 */
export const indexDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    chunkSize: v.optional(v.number()),
    chunkOverlap: v.optional(v.number()),
    embeddingModel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    skipped: boolean;
    chunksInserted: number;
    chunksEmbedded: number;
  }> => {
    // ── Idempotency check: single-row probe (avoids 16MB read limit) ──
    const { exists } = await ctx.runQuery(
      internal.retrieval.chunks.hasChunksForDocConfig,
      {
        documentId: args.documentId,
        indexConfigHash: args.indexConfigHash,
      },
    );

    if (exists) {
      // Chunks exist — skip Phase A, go to Phase B.
      // If all are already embedded, Phase B finds nothing and returns early.
    } else {
      // ── PHASE A: Chunk & Store (pure compute, atomic) ──
      const doc = await ctx.runQuery(internal.crud.documents.getInternal, {
        id: args.documentId,
      });

      const chunker = new RecursiveCharacterChunker({
        chunkSize: args.chunkSize ?? 1000,
        chunkOverlap: args.chunkOverlap ?? 200,
      });

      const evalDoc = createDocument({ id: doc.docId, content: doc.content });
      const chunks = chunker.chunkWithPositions(evalDoc);

      if (chunks.length === 0) {
        return { skipped: false, chunksInserted: 0, chunksEmbedded: 0 };
      }

      // Insert ALL chunks WITHOUT embeddings in one atomic mutation
      await ctx.runMutation(internal.retrieval.chunks.insertChunkBatch, {
        chunks: chunks.map((c) => ({
          documentId: args.documentId,
          kbId: args.kbId,
          indexConfigHash: args.indexConfigHash,
          chunkId: c.id,
          content: c.content,
          start: c.start,
          end: c.end,
          metadata: c.metadata ?? {},
        })),
      });
    }

    // ── PHASE B: Embed in Batches (API calls, resumable) ──
    //
    // Collect unembedded chunks via paginated queries — each ctx.runQuery()
    // gets its own 16MB read budget, avoiding the limit that .collect() hits
    // on large documents where embedded chunks carry 12KB vectors each.
    const unembedded: any[] = [];
    let totalChunks = 0;
    let pageCursor: string | null = null;
    let pageDone = false;

    while (!pageDone) {
      const page: any = await ctx.runQuery(
        internal.retrieval.chunks.getChunksByDocConfigPage,
        {
          documentId: args.documentId,
          indexConfigHash: args.indexConfigHash,
          cursor: pageCursor,
          pageSize: 100,
        },
      );
      totalChunks += page.chunks.length;
      for (const chunk of page.chunks) {
        if (chunk.embedding === undefined) {
          unembedded.push(chunk);
        }
      }
      pageDone = page.isDone;
      pageCursor = page.continueCursor;
    }

    if (unembedded.length === 0) {
      // All chunks already embedded (fully indexed on a previous run)
      return { skipped: true, chunksInserted: 0, chunksEmbedded: 0 };
    }

    const embedder = createEmbedder(args.embeddingModel);
    let totalEmbedded = 0;

    for (let i = 0; i < unembedded.length; i += EMBED_BATCH_SIZE) {
      const batch = unembedded.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map((c: any) => c.content);

      // This is the failure point — WorkPool retries the whole action,
      // but Phase A is skipped and completed batches are skipped
      const embeddings = await embedder.embed(texts);

      // Patch this batch's embeddings — checkpoint saved.
      // Retry with backoff if concurrent actions saturate write throughput.
      await retryOnWriteLimit(() =>
        ctx.runMutation(internal.retrieval.chunks.patchChunkEmbeddings, {
          patches: batch.map((c: any, idx: number) => ({
            chunkId: c._id,
            embedding: embeddings[idx],
          })),
        }),
      );

      totalEmbedded += batch.length;
    }

    return {
      skipped: false,
      chunksInserted: totalChunks,
      chunksEmbedded: totalEmbedded,
    };
  },
});

// ─── Cleanup Action ───

/**
 * Paginated deletion of all chunks for a (kbId, indexConfigHash).
 * Plain action — no WorkPool needed (just DB deletions, no API calls).
 */
export const cleanupAction = internalAction({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    jobId: v.optional(v.id("indexingJobs")),
    deleteDocuments: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let totalDeleted = 0;

    // Paginated chunk deletion
    let hasMore = true;
    while (hasMore) {
      const result = await ctx.runMutation(internal.retrieval.chunks.deleteKbConfigChunks, {
        kbId: args.kbId,
        indexConfigHash: args.indexConfigHash,
        limit: CLEANUP_BATCH_SIZE,
      });
      totalDeleted += result.deleted;
      hasMore = result.hasMore;
    }

    // Optionally delete source documents
    let docsDeleted = 0;
    if (args.deleteDocuments) {
      const docs = await ctx.runQuery(internal.crud.documents.listByKbInternal, {
        kbId: args.kbId,
      });
      for (const doc of docs) {
        await ctx.runMutation(internal.retrieval.chunks.deleteDocumentChunks, {
          documentId: doc._id,
        });
        // Note: document deletion itself is not done here — that would
        // require a separate documents.deleteInternal mutation
      }
      docsDeleted = docs.length;
    }

    // Delete the associated indexing job record
    if (args.jobId) {
      await ctx.runMutation(internal.retrieval.indexing.deleteJob, {
        jobId: args.jobId,
      });
    }

    return { chunksDeleted: totalDeleted, docsDeleted };
  },
});
