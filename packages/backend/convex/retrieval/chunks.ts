import { internalMutation, internalQuery, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

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

// ─── Queries (KB-level, paginated — for BM25 / hybrid search) ───

/**
 * Read one page of chunks for a (kbId, indexConfigHash) pair.
 *
 * Returns chunk text + position data WITHOUT embeddings (each embedding is
 * ~12 KB; stripping them keeps pages well under 16 MB). Joins the
 * user-facing `docId` string from the parent `documents` table.
 *
 * Designed to be called in a loop from an ACTION so that each
 * ctx.runQuery() call gets its own 16 MB read budget.
 */
export const getChunksByKbConfigPage = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    cursor: v.union(v.string(), v.null()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const numItems = args.pageSize ?? 500;
    const page = await ctx.db
      .query("documentChunks")
      .withIndex("by_kb_config", (q) =>
        q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash),
      )
      .paginate({ numItems, cursor: args.cursor as any ?? null });

    // Join docId and strip embedding in one pass
    const docCache = new Map<string, string>();
    const chunks = [];
    for (const c of page.page) {
      let docId = docCache.get(c.documentId);
      if (docId === undefined) {
        const doc = await ctx.db.get(c.documentId);
        docId = doc?.docId ?? "";
        docCache.set(c.documentId, docId);
      }
      chunks.push({
        chunkId: c.chunkId,
        content: c.content,
        docId,
        start: c.start,
        end: c.end,
        metadata: c.metadata ?? {},
      });
    }

    return {
      chunks,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
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
 * Check if any chunks exist for a (documentId, indexConfigHash).
 * Reads at most 1 row — avoids the 16MB limit entirely.
 */
export const hasChunksForDocConfig = internalQuery({
  args: {
    documentId: v.id("documents"),
    indexConfigHash: v.string(),
  },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("documentChunks")
      .withIndex("by_doc_config", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("indexConfigHash", args.indexConfigHash),
      )
      .first();
    return { exists: first !== null };
  },
});

/**
 * Read one page of chunks for a (documentId, indexConfigHash).
 *
 * Returns the chunks in the page, whether more pages exist, and a cursor
 * for the next page. Designed to be called in a loop from an ACTION so that
 * each ctx.runQuery() call gets its own 16MB read budget.
 *
 * Page size is kept small (default 100) so that even pages full of embedded
 * chunks (each ~13KB with the 1536-dim vector) stay well under 16MB.
 */
export const getChunksByDocConfigPage = internalQuery({
  args: {
    documentId: v.id("documents"),
    indexConfigHash: v.string(),
    cursor: v.union(v.string(), v.null()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const numItems = args.pageSize ?? 100;
    const page = await ctx.db
      .query("documentChunks")
      .withIndex("by_doc_config", (q) =>
        q
          .eq("documentId", args.documentId)
          .eq("indexConfigHash", args.indexConfigHash),
      )
      .paginate({ numItems, cursor: args.cursor as any ?? null });

    return {
      chunks: page.page,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Public paginated query for Index tab — fetches chunks by (kbId, indexConfigHash, documentId?).
 * Optionally filters by documentId for narrower browsing.
 */
export const getChunksByRetrieverPage = query({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    documentId: v.optional(v.id("documents")),
    cursor: v.union(v.string(), v.null()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("KB not found");

    const numItems = args.pageSize ?? 50;

    const baseQuery = args.documentId
      ? ctx.db
          .query("documentChunks")
          .withIndex("by_doc_config", (q) =>
            q
              .eq("documentId", args.documentId!)
              .eq("indexConfigHash", args.indexConfigHash),
          )
      : ctx.db
          .query("documentChunks")
          .withIndex("by_kb_config", (q) =>
            q
              .eq("kbId", args.kbId)
              .eq("indexConfigHash", args.indexConfigHash),
          );

    const page = await baseQuery.paginate({
      numItems,
      cursor: args.cursor as any ?? null,
    });

    return {
      chunks: page.page.map((c) => ({
        _id: c._id,
        chunkId: c.chunkId,
        documentId: c.documentId,
        content: c.content,
        start: c.start,
        end: c.end,
        metadata: c.metadata ?? {},
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Get chunks for a (documentId, indexConfigHash) where embedding is not set.
 * Used to resume Phase B after a crash.
 *
 * @deprecated Use getChunksByDocConfigPage from an action loop instead,
 * filtering for unembedded chunks at the action level. This query can hit
 * the 16MB read limit on large documents because it scans all chunks
 * (including embedded ones with 12KB vectors) within a single execution.
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
 * Fetch chunk records by IDs WITHOUT touching the documents table.
 * Use this before post-filtering, then call fetchDocIdMap for survivors only —
 * documents.content can be megabytes and would blow Convex's 16 MB read budget
 * if hydrated for every over-fetched chunk.
 */
export const fetchChunksByIds = internalQuery({
  args: { ids: v.array(v.id("documentChunks")) },
  handler: async (ctx, args) => {
    const chunks = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  },
});

/**
 * Map documentId → external docId. Caller must deduplicate ids before calling.
 * Reads full document records (Convex has no field projection), so the caller
 * is responsible for keeping the input list small.
 */
export const fetchDocIdMap = internalQuery({
  args: { documentIds: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const map: Record<string, string> = {};
    for (const id of args.documentIds) {
      const doc = await ctx.db.get(id);
      if (doc) map[id.toString()] = doc.docId;
    }
    return map;
  },
});
