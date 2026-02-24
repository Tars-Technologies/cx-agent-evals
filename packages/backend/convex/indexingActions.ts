"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  RecursiveCharacterChunker,
  OpenAIEmbedder,
  createDocument,
} from "rag-evaluation-system";
import OpenAI from "openai";

/** Number of chunks to embed in one API call / checkpoint batch */
const EMBED_BATCH_SIZE = 200;

/** Deletion batch size for cleanup */
const CLEANUP_BATCH_SIZE = 500;

// ─── Helpers ───

function createEmbedder(model?: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey });
  return new OpenAIEmbedder({
    model: model ?? "text-embedding-3-small",
    client: openai,
  });
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
    // ── Idempotency check: query existing chunks ──
    const existingChunks: any[] = await ctx.runQuery(
      internal.rag.getChunksByDocConfig,
      {
        documentId: args.documentId,
        indexConfigHash: args.indexConfigHash,
      },
    );

    if (existingChunks.length > 0) {
      const allEmbedded = existingChunks.every(
        (c: any) => c.embedding !== undefined,
      );
      if (allEmbedded) {
        return { skipped: true, chunksInserted: 0, chunksEmbedded: 0 };
      }
      // Some chunks exist but not all embedded — skip to Phase B
    } else {
      // ── PHASE A: Chunk & Store (pure compute, atomic) ──
      const doc = await ctx.runQuery(internal.documents.getInternal, {
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
      await ctx.runMutation(internal.rag.insertChunkBatch, {
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
    const unembedded = await ctx.runQuery(internal.rag.getUnembeddedChunks, {
      documentId: args.documentId,
      indexConfigHash: args.indexConfigHash,
    });

    if (unembedded.length === 0) {
      // All chunks already embedded (possible if Phase A was from a previous run)
      return { skipped: false, chunksInserted: 0, chunksEmbedded: 0 };
    }

    const embedder = createEmbedder(args.embeddingModel);
    let totalEmbedded = 0;

    for (let i = 0; i < unembedded.length; i += EMBED_BATCH_SIZE) {
      const batch = unembedded.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map((c: any) => c.content);

      // This is the failure point — WorkPool retries the whole action,
      // but Phase A is skipped and completed batches are skipped
      const embeddings = await embedder.embed(texts);

      // Patch this batch's embeddings — checkpoint saved
      await ctx.runMutation(internal.rag.patchChunkEmbeddings, {
        patches: batch.map((c: any, idx: number) => ({
          chunkId: c._id,
          embedding: embeddings[idx],
        })),
      });

      totalEmbedded += batch.length;
    }

    // Count total chunks for this document (including previously embedded)
    const allChunks: any[] = await ctx.runQuery(internal.rag.getChunksByDocConfig, {
      documentId: args.documentId,
      indexConfigHash: args.indexConfigHash,
    });

    return {
      skipped: false,
      chunksInserted: allChunks.length,
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
      const result = await ctx.runMutation(internal.rag.deleteKbConfigChunks, {
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
      const docs = await ctx.runQuery(internal.documents.listByKbInternal, {
        kbId: args.kbId,
      });
      for (const doc of docs) {
        await ctx.runMutation(internal.rag.deleteDocumentChunks, {
          documentId: doc._id,
        });
        // Note: document deletion itself is not done here — that would
        // require a separate documents.deleteInternal mutation
      }
      docsDeleted = docs.length;
    }

    // Delete the associated indexing job record
    if (args.jobId) {
      await ctx.runMutation(internal.indexing.deleteJob, {
        jobId: args.jobId,
      });
    }

    return { chunksDeleted: totalDeleted, docsDeleted };
  },
});
