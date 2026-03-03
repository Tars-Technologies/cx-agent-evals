import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ─── Batch Mutations (new — for two-phase indexing) ───

/**
 * Insert multiple chunks in one atomic transaction, WITHOUT embeddings.
 * Phase A of two-phase indexing — pure compute, no API calls.
 */
export const insertChunkBatch = internalMutation({
  args: {
    chunks: v.array(
      v.object({
        documentId: v.id("documents"),
        kbId: v.id("knowledgeBases"),
        indexConfigHash: v.string(),
        chunkId: v.string(),
        content: v.string(),
        start: v.number(),
        end: v.number(),
        metadata: v.any(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const chunk of args.chunks) {
      const id = await ctx.db.insert("documentChunks", chunk);
      ids.push(id);
    }
    return { inserted: ids.length, ids };
  },
});

/**
 * Patch embedding vectors onto existing chunk records.
 * Phase B checkpoint — each batch call persists progress.
 */
export const patchChunkEmbeddings = internalMutation({
  args: {
    patches: v.array(
      v.object({
        chunkId: v.id("documentChunks"),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const patch of args.patches) {
      await ctx.db.patch(patch.chunkId, { embedding: patch.embedding });
    }
    return { patched: args.patches.length };
  },
});

/**
 * Delete multiple chunks by ID in one transaction.
 */
export const deleteChunkBatch = internalMutation({
  args: {
    ids: v.array(v.id("documentChunks")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    return { deleted: args.ids.length };
  },
});

/**
 * Paginated deletion by (kbId, indexConfigHash).
 * Returns { deleted, hasMore } so the caller can loop.
 */
export const deleteKbConfigChunks = internalMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.limit ?? 500;
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .take(batchSize);

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    return { deleted: chunks.length, hasMore: chunks.length === batchSize };
  },
});

// ─── Queries (new — for two-phase indexing) ───

/**
 * Get all chunks for a (documentId, indexConfigHash) pair.
 */
export const getChunksByDocConfig = internalQuery({
  args: {
    documentId: v.id("documents"),
    indexConfigHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documentChunks")
      .withIndex("by_doc_config", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("indexConfigHash", args.indexConfigHash),
      )
      .collect();
  },
});

/**
 * Get chunks for a (documentId, indexConfigHash) where embedding is not set.
 * Used to resume Phase B after a crash.
 */
export const getUnembeddedChunks = internalQuery({
  args: {
    documentId: v.id("documents"),
    indexConfigHash: v.string(),
  },
  handler: async (ctx, args) => {
    const allChunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_doc_config", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("indexConfigHash", args.indexConfigHash),
      )
      .collect();
    return allChunks.filter((c) => c.embedding === undefined);
  },
});

/**
 * Delete all chunks for a document.
 */
export const deleteDocumentChunks = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    return { chunksDeleted: chunks.length };
  },
});

// ─── Queries (existing, updated) ───

/**
 * Check if a knowledge base has been indexed for a given config.
 * Returns true only if chunks with embeddings exist.
 */
export const isIndexed = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.indexConfigHash) {
      const chunks = await ctx.db
        .query("documentChunks")
        .withIndex("by_kb_config", (q) =>
          q
            .eq("kbId", args.kbId)
            .eq("indexConfigHash", args.indexConfigHash!),
        )
        .take(1);
      return chunks.length > 0 && chunks[0].embedding !== undefined;
    }
    // Fallback: any chunks for this KB (backward compat)
    const first = await ctx.db
      .query("documentChunks")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .first();
    return first !== null;
  },
});

/**
 * Fetch full chunk records by IDs, including parent document's docId.
 * Used after vector search to hydrate results.
 */
export const fetchChunksWithDocs = internalQuery({
  args: {
    ids: v.array(v.id("documentChunks")),
  },
  handler: async (ctx, args) => {
    const chunks = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (!chunk) continue;

      const doc = await ctx.db.get(chunk.documentId);
      chunks.push({
        ...chunk,
        docId: doc?.docId ?? "",
      });
    }
    return chunks;
  },
});
