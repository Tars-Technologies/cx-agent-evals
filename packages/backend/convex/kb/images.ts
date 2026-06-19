import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"

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
