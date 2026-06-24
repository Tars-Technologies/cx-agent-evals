import { Workpool } from "@convex-dev/workpool"
import { v } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx
} from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"

// Bounded-concurrency pool so a crawl finalizing many docs at once does not
// slam OpenAI; transient embed failures retry (E7).
const imagePool = new Workpool(components.imageProcessingPool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 }
})

/** Enqueue document image processing (E7/E8). Safe to call from any mutation. */
export async function scheduleDocImageProcessing(
  ctx: MutationCtx,
  docId: Id<"documents">
): Promise<void> {
  await imagePool.enqueueAction(
    ctx,
    internal.kb.images_actions.processDocImages,
    { docId }
  )
}

const imageInputValidator = v.object({
  imageId: v.string(),
  url: v.string(),
  alt: v.string()
})

const docImageInputValidator = v.object({
  imageId: v.string(),
  url: v.string(),
  alt: v.string(),
  embedding: v.optional(v.array(v.float64()))
})

/**
 * Delete-and-replace a document's images (E1/E2). Rows are keyed by
 * (sourceDocId, imageId): rows for this doc whose imageId is not in `images`
 * are deleted, the rest are inserted or patched (alt/url/embedding). This is
 * what keeps the doc-gated pool free of dead rows after a re-scrape.
 */
export const upsertDocImages = internalMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
    sourceDocId: v.id("documents"),
    images: v.array(docImageInputValidator)
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("kbImages")
      .withIndex("by_source_doc", (q) => q.eq("sourceDocId", args.sourceDocId))
      .collect()
    const keep = new Set(args.images.map((i) => i.imageId))
    for (const row of existing) {
      if (!keep.has(row.imageId)) await ctx.db.delete(row._id)
    }
    const byId = new Map(existing.map((r) => [r.imageId, r]))
    for (const img of args.images) {
      const prev = byId.get(img.imageId)
      if (prev) {
        await ctx.db.patch(prev._id, {
          url: img.url,
          alt: img.alt,
          embedding: img.embedding
        })
      } else {
        await ctx.db.insert("kbImages", {
          imageId: img.imageId,
          kbId: args.kbId,
          orgId: args.orgId,
          url: img.url,
          alt: img.alt,
          embedding: img.embedding,
          sourceDocId: args.sourceDocId,
          createdAt: Date.now()
        })
      }
    }
  }
})

/** Patch a document's content with re-annotated image markers (E5). */
export const setDocImageAnnotations = internalMutation({
  args: { docId: v.id("documents"), content: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.docId)
    if (!doc) return
    await ctx.db.patch(args.docId, {
      content: args.content,
      contentLength: args.content.length
    })
  }
})

/**
 * Doc-gated image pool for retrieval (E9): each document's images, tagged with
 * their documentId so the caller can group by doc order. Skips rows with no
 * resolvable url (a future storage-only row should never enter the menu).
 */
export const imagesForDocs = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    documentIds: v.array(v.id("documents"))
  },
  handler: async (ctx, args) => {
    const out: Array<{
      documentId: Id<"documents">
      imageId: string
      alt: string
      embedding?: number[]
    }> = []
    for (const documentId of args.documentIds) {
      const rows = await ctx.db
        .query("kbImages")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", documentId))
        .collect()
      for (const r of rows) {
        if (r.kbId !== args.kbId || !r.url) continue
        out.push({
          documentId,
          imageId: r.imageId,
          alt: r.alt,
          embedding: r.embedding
        })
      }
    }
    return out
  }
})

/** Idempotent upsert of parsed images for one chunk, keyed by (kbId, imageId). */
export const upsertImagesForChunk = internalMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
    sourceDocId: v.id("documents"),
    images: v.array(imageInputValidator)
  },
  handler: async (ctx, args) => {
    for (const img of args.images) {
      const existing = await ctx.db
        .query("kbImages")
        .withIndex("by_image_id", (q) => q.eq("imageId", img.imageId))
        .first()
      // by_image_id is global; scope the dedup to this kb so two KBs can't
      // clobber each other (ids already include kbId, so a cross-kb match is
      // effectively impossible, but check kbId for correctness).
      if (existing && existing.kbId === args.kbId) continue
      await ctx.db.insert("kbImages", {
        imageId: img.imageId,
        kbId: args.kbId,
        orgId: args.orgId,
        url: img.url,
        alt: img.alt,
        sourceDocId: args.sourceDocId,
        createdAt: Date.now()
      })
    }
  }
})

/**
 * List all chunks for a KB (id + content + metadata) for the backfill action.
 * POC: uses .collect(); for large KBs this should paginate (chunks carry 12KB
 * vectors). Flagged as a follow-up — see plan Task 9.
 */
export const listChunkIdsForKb = internalQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("documentChunks")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    return rows.map((r) => ({
      id: r._id,
      content: r.content,
      documentId: r.documentId,
      metadata: r.metadata
    }))
  }
})

/** Map of imageId → url for a KB, for re-evaluating existing img_ markers. */
export const imageUrlMapForKb = internalQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("kbImages")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    return rows.flatMap((r) =>
      r.url ? [{ imageId: r.imageId, url: r.url }] : []
    )
  }
})

/** Delete kbImages rows (e.g. decorative images dropped during a re-clean). */
export const deleteKbImagesByIds = internalMutation({
  args: { kbId: v.id("knowledgeBases"), imageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const imageId of args.imageIds) {
      const row = await ctx.db
        .query("kbImages")
        .withIndex("by_image_id", (q) => q.eq("imageId", imageId))
        .first()
      if (row && row.kbId === args.kbId) await ctx.db.delete(row._id)
    }
  }
})

/** Patch a chunk's rewritten content + metadata.images (backfill). */
export const patchChunkImages = internalMutation({
  args: {
    chunkId: v.id("documentChunks"),
    content: v.string(),
    images: v.array(v.object({ imageId: v.string(), alt: v.string() }))
  },
  handler: async (ctx, args) => {
    const chunk = await ctx.db.get(args.chunkId)
    if (!chunk) return
    await ctx.db.patch(args.chunkId, {
      content: args.content,
      metadata: { ...(chunk.metadata ?? {}), images: args.images }
    })
  }
})

/**
 * Resolve image IDs to {imageId,url,alt}, scoped to the org and the set of KBs
 * the agent can search (one agent may link retrievers across several KBs, so a
 * single-KB scope would drop images from all but the first).
 */
export const getImagesByIds = internalQuery({
  args: {
    kbIds: v.array(v.id("knowledgeBases")),
    orgId: v.string(),
    imageIds: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const allowedKbs = new Set<string>(args.kbIds.map((id) => id))
    const out: Array<{ imageId: string; url: string; alt: string }> = []
    for (const imageId of args.imageIds) {
      const row = await ctx.db
        .query("kbImages")
        .withIndex("by_image_id", (q) => q.eq("imageId", imageId))
        .first()
      if (!row) continue
      if (!allowedKbs.has(row.kbId) || row.orgId !== args.orgId) continue // V3
      if (!row.url) continue // POC: url-only; storageId path is future D3→B
      out.push({ imageId: row.imageId, url: row.url, alt: row.alt })
    }
    return out
  }
})

/** How many images are indexed for a KB (diagnostic for the multimodal path). */
export const countForKb = tenantQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) return 0
    const rows = await ctx.db
      .query("kbImages")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    return rows.length
  }
})

/**
 * Tenant-triggered reprocess: run document-level image processing over every
 * finalized document in a KB (replaces the old chunk-rewrite backfill). Each
 * doc is enqueued through the bounded image pool (E7).
 */
export const reprocessKbImages = tenantMutation({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found")
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    let scheduled = 0
    for (const d of docs) {
      if (d.parseStatus && d.parseStatus !== "done") continue // skip placeholders
      await scheduleDocImageProcessing(ctx, d._id)
      scheduled++
    }
    return { scheduled }
  }
})
