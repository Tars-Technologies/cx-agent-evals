import { mutation, query, internalQuery, internalMutation } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx); // Require auth
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    kbId: v.id("knowledgeBases"),
    storageId: v.id("_storage"),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    const content = args.content;
    const docId = args.title;

    const docRowId = await ctx.db.insert("documents", {
      orgId,
      kbId: args.kbId,
      docId,
      title: args.title,
      content,
      fileId: args.storageId,
      contentLength: content.length,
      metadata: {},
      createdAt: Date.now(),
    });

    // Increment denormalized document count
    await ctx.db.patch(args.kbId, {
      documentCount: (kb.documentCount ?? 0) + 1,
    });

    return docRowId;
  },
});

export const listByKb = query({
  args: {
    kbId: v.id("knowledgeBases"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    const page = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .paginate(args.paginationOpts);

    // Return without full content for listing (content can be large)
    return {
      ...page,
      page: page.page.map((doc) => ({
        _id: doc._id,
        docId: doc.docId,
        title: doc.title,
        contentLength: doc.contentLength,
        sourceType: doc.sourceType,
        createdAt: doc.createdAt,
      })),
    };
  },
});

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      return null;
    }
    return doc;
  },
});

/**
 * Public query that returns a document's content fields with auth check.
 * Used by the Index tab to display document source text alongside chunks.
 */
export const getContent = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc) throw new Error("Document not found");
    // Verify org access via KB
    const kb = await ctx.db.get(doc.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Access denied");
    return { docId: doc.docId, content: doc.content, kbId: doc.kbId };
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Document not found");
    }
    if (doc.fileId) {
      await ctx.storage.delete(doc.fileId);
    }
    await ctx.db.delete(args.id);

    // Decrement denormalized document count
    const kb = await ctx.db.get(doc.kbId);
    if (kb) {
      await ctx.db.patch(doc.kbId, {
        documentCount: Math.max(0, (kb.documentCount ?? 0) - 1),
      });
    }
  },
});

/**
 * Internal query: list all documents in a KB (no auth check).
 * Used by generation/experiment actions.
 */
export const listByKbInternal = internalQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect();
  },
});

/**
 * Internal query: get a single document by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) throw new Error("Document not found");
    return doc;
  },
});

/**
 * Internal mutation: create a document from scraped content (no file upload).
 * Used by scraping actions to persist crawled pages.
 */
export const createFromScrape = internalMutation({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    title: v.string(),
    content: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const docRowId = await ctx.db.insert("documents", {
      orgId: args.orgId,
      kbId: args.kbId,
      docId: args.title,
      title: args.title,
      content: args.content,
      contentLength: args.content.length,
      metadata: {},
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType,
      createdAt: Date.now(),
    });

    // Increment denormalized document count
    const kb = await ctx.db.get(args.kbId);
    if (kb) {
      await ctx.db.patch(args.kbId, {
        documentCount: (kb.documentCount ?? 0) + 1,
      });
    }

    return docRowId;
  },
});
