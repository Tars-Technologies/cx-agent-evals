/**
 * Document CRUD: upload via Convex storage, scrape ingestion, doc-count maintenance.
 */
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import type { Doc } from "../_generated/dataModel"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"
import { computeDocId } from "../lib/docId"

type DocSummary = Pick<
  Doc<"documents">,
  "_id" | "docId" | "title" | "contentLength" | "sourceType" | "priority"
>

function projectDocSummary(doc: Doc<"documents">): DocSummary {
  return {
    _id: doc._id,
    docId: doc.docId,
    title: doc.title,
    contentLength: doc.contentLength,
    sourceType: doc.sourceType,
    priority: doc.priority
  }
}

// Cap on point lookups per call. Questions referencing more than this many
// distinct docs will have the overflow silently dropped — span-group headers
// for those docs fall back to raw docId strings and navigateToDoc() becomes
// a no-op for them. In practice questions span <10 docs; revisit if that
// changes.
const MAX_DOC_IDS_PER_LOOKUP = 50
const MAX_TITLE_SEARCH_LIMIT = 100
// Hard cap on listCustomizedDocs. Each row reads full `content` (Convex
// materializes the whole document regardless of projection), so 100 × ~100KB
// keeps us well under the per-function 16MB read budget. The wizard's
// allocation math needs the full customized set, so we don't paginate —
// just cap. Revisit if a customer customizes more than 100 docs.
const MAX_CUSTOMIZED_DOCS_LIMIT = 100

export const generateUploadUrl = tenantMutation({
  args: {},
  handler: async (ctx) => {
    // Auth required — enforced by tenantMutation wrapper
    return await ctx.storage.generateUploadUrl()
  }
})

export const create = tenantMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    storageId: v.id("_storage"),
    title: v.string(),
    content: v.string()
  },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }

    const content = args.content
    const docId = await computeDocId({ fileId: args.storageId })

    const docRowId = await ctx.db.insert("documents", {
      orgId,
      kbId: args.kbId,
      docId,
      title: args.title,
      content,
      fileId: args.storageId,
      contentLength: content.length,
      metadata: {},
      createdAt: Date.now()
    })

    // Increment denormalized document count
    await ctx.db.patch(args.kbId, {
      documentCount: (kb.documentCount ?? 0) + 1
    })

    return docRowId
  }
})

export const listByKb = tenantQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    paginationOpts: paginationOptsValidator
  },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }

    const page = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .paginate(args.paginationOpts)

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
        priority: doc.priority
      }))
    }
  }
})

export const get = tenantQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const doc = await ctx.db.get(args.id)
    if (!doc || doc.orgId !== orgId) {
      return null
    }
    return doc
  }
})

/**
 * Resolve a known set of `docId` strings to their full doc rows. Used by the
 * editor / dataset page to resolve span references without loading the whole
 * KB doc list. Order matches input where possible; missing docs are omitted.
 */
export const getDocsByDocIds = tenantQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    docIds: v.array(v.string())
  },
  handler: async (ctx, args): Promise<DocSummary[]> => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) return []

    const ids = args.docIds.slice(0, MAX_DOC_IDS_PER_LOOKUP)
    const docs = await Promise.all(
      ids.map((docId) =>
        ctx.db
          .query("documents")
          .withIndex("by_kb_doc_id", (q) =>
            q.eq("kbId", args.kbId).eq("docId", docId)
          )
          .first()
      )
    )
    return docs.flatMap((doc) => (doc ? [projectDocSummary(doc)] : []))
  }
})

/**
 * Server-side title search within a KB. Empty/whitespace query returns [].
 */
export const searchDocsByTitle = tenantQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    query: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<DocSummary[]> => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) return []

    const trimmed = args.query.trim()
    if (!trimmed) return []

    const limit = Math.min(args.limit ?? 20, MAX_TITLE_SEARCH_LIMIT)
    const hits = await ctx.db
      .query("documents")
      .withSearchIndex("search_title", (q) =>
        q.search("title", trimmed).eq("kbId", args.kbId)
      )
      .take(limit)

    return hits.map(projectDocSummary)
  }
})

/**
 * Lists docs in a KB whose `priority` field is set. Uses the `by_kb_priority`
 * compound index so only customized rows are read — scanning by_kb alone
 * would read every doc's full content and re-hit the 16MB limit on large KBs.
 */
export const listCustomizedDocs = tenantQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args): Promise<DocSummary[]> => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) return []

    const limit = Math.min(
      args.limit ?? MAX_CUSTOMIZED_DOCS_LIMIT,
      MAX_CUSTOMIZED_DOCS_LIMIT
    )
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_kb_priority", (q) =>
        q.eq("kbId", args.kbId).gte("priority", 1)
      )
      .order("desc")
      .take(limit)

    return rows.map(projectDocSummary)
  }
})

/**
 * Public query that returns a document's content fields with auth check.
 * Used by the Index tab to display document source text alongside chunks.
 */
export const getContent = tenantQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const doc = await ctx.db.get(args.id)
    if (!doc) throw new Error("Document not found")
    // Verify org access via KB
    const kb = await ctx.db.get(doc.kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("Access denied")
    return {
      docId: doc.docId,
      title: doc.title,
      content: doc.content,
      kbId: doc.kbId
    }
  }
})

export const remove = tenantMutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const doc = await ctx.db.get(args.id)
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Document not found")
    }
    if (doc.fileId) {
      await ctx.storage.delete(doc.fileId)
    }
    await ctx.db.delete(args.id)

    // Decrement denormalized document count
    const kb = await ctx.db.get(doc.kbId)
    if (kb) {
      const currentCount = kb.documentCount ?? 0
      if (currentCount === 0) {
        // Floor clamp will fire — counter is already out of sync with reality.
        // Surface this so we notice instead of silently masking the drift.
        console.warn(
          `documentCount drift: remove called on kb=${doc.kbId} where documentCount is already 0`
        )
      }
      await ctx.db.patch(doc.kbId, {
        documentCount: Math.max(0, currentCount - 1)
      })
    }
  }
})

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
      .collect()
  }
})

/**
 * Internal query: get a single document by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id)
    if (!doc) throw new Error("Document not found")
    return doc
  }
})

export const updatePriority = tenantMutation({
  args: {
    documentId: v.id("documents"),
    priority: v.number()
  },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const doc = await ctx.db.get(args.documentId)
    if (!doc || doc.orgId !== orgId) throw new Error("Document not found")
    if (args.priority < 1 || args.priority > 5)
      throw new Error("Priority must be 1-5")
    await ctx.db.patch(args.documentId, { priority: args.priority })
  }
})

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
    sourceType: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const docRowId = await ctx.db.insert("documents", {
      orgId: args.orgId,
      kbId: args.kbId,
      docId: await computeDocId({ sourceUrl: args.sourceUrl }),
      title: args.title,
      content: args.content,
      contentLength: args.content.length,
      metadata: {},
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType,
      createdAt: Date.now()
    })

    // Increment denormalized document count
    const kb = await ctx.db.get(args.kbId)
    if (kb) {
      await ctx.db.patch(args.kbId, {
        documentCount: (kb.documentCount ?? 0) + 1
      })
    }

    return docRowId
  }
})
