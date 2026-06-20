import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"

const imageInputValidator = v.object({
  imageId: v.string(),
  url: v.string(),
  alt: v.string()
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

/** Resolve a set of image IDs to {imageId,url,alt}, scoped to org + kb. */
export const getImagesByIds = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
    imageIds: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const out: Array<{ imageId: string; url: string; alt: string }> = []
    for (const imageId of args.imageIds) {
      const row = await ctx.db
        .query("kbImages")
        .withIndex("by_image_id", (q) => q.eq("imageId", imageId))
        .first()
      if (!row) continue
      if (row.kbId !== args.kbId || row.orgId !== args.orgId) continue // V3
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
 * Tenant-triggered backfill: re-parse a KB's existing chunks for images.
 * Schedules the node action (idempotent). For KBs indexed before this feature.
 */
export const reindexForImages = tenantMutation({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found")
    await ctx.scheduler.runAfter(
      0,
      internal.kb.images_actions.backfillImagesForKb,
      { kbId: args.kbId, orgId }
    )
    return { scheduled: true }
  }
})
