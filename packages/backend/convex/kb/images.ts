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

const docImageInputValidator = v.object({
  imageId: v.string(),
  url: v.string(),
  alt: v.string(),
  mediaType: v.optional(
    v.union(v.literal("image"), v.literal("video"), v.literal("doc_link"))
  ),
  // Vectors live in Qdrant (see kb/media_runtime.ts); kbMedia keeps only the
  // skip-reembed hash. The hash is present iff a vector was successfully
  // upserted for this input+model.
  embeddingInputHash: v.optional(v.string()),
  manualContext: v.optional(v.string())
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
      .query("kbMedia")
      .withIndex("by_source_doc", (q) => q.eq("sourceDocId", args.sourceDocId))
      .collect()

    // Dedup the input by imageId (last wins) so one call can't insert twice.
    const inputById = new Map(args.images.map((i) => [i.imageId, i]))

    // Group existing rows by imageId (there may be pre-existing duplicates from
    // an earlier race — this call collapses them to a single survivor).
    const existingById = new Map<string, typeof existing>()
    for (const r of existing) {
      const arr = existingById.get(r.imageId) ?? []
      arr.push(r)
      existingById.set(r.imageId, arr)
    }

    // Delete rows no longer present, and collapse any duplicate survivors.
    const survivorById = new Map<string, (typeof existing)[number]>()
    for (const [imageId, rows] of existingById) {
      if (!inputById.has(imageId)) {
        for (const r of rows) await ctx.db.delete(r._id)
        continue
      }
      survivorById.set(imageId, rows[0])
      for (const dup of rows.slice(1)) await ctx.db.delete(dup._id) // dedup
    }

    for (const [imageId, img] of inputById) {
      const survivor = survivorById.get(imageId)
      if (survivor) {
        await ctx.db.patch(survivor._id, {
          url: img.url,
          alt: img.alt,
          mediaType: img.mediaType ?? "image",
          // Shed any legacy inline vector — vectors live in Qdrant now.
          embedding: undefined,
          embeddingInputHash: img.embeddingInputHash,
          manualContext: img.manualContext
        })
      } else {
        await ctx.db.insert("kbMedia", {
          imageId,
          kbId: args.kbId,
          orgId: args.orgId,
          url: img.url,
          alt: img.alt,
          mediaType: img.mediaType ?? "image",
          embeddingInputHash: img.embeddingInputHash,
          manualContext: img.manualContext,
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
 * Prior media metadata (input hashes + manual context) for a document's images,
 * so processDocImages can skip re-embedding an unchanged image (hash match) and
 * preserve user-authored context across re-scrapes. Vectors are NOT returned —
 * they live in Qdrant; a matching hash means the vector is already upserted.
 */
export const docMediaPriorMeta = internalQuery({
  args: { sourceDocId: v.id("documents") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("kbMedia")
      .withIndex("by_source_doc", (q) => q.eq("sourceDocId", args.sourceDocId))
      .collect()
    return rows.map((r) => ({
      imageId: r.imageId,
      embeddingInputHash: r.embeddingInputHash,
      manualContext: r.manualContext
    }))
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
    }> = []
    for (const documentId of args.documentIds) {
      const rows = await ctx.db
        .query("kbMedia")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", documentId))
        .collect()
      for (const r of rows) {
        if (r.kbId !== args.kbId || !r.url) continue
        if ((r.mediaType ?? "image") === "doc_link") continue // not a menu item
        out.push({
          documentId,
          imageId: r.imageId,
          alt: r.alt
        })
      }
    }
    return out
  }
})

/**
 * Doc-gated media metadata for ranking (E9). Returns each menu-eligible image's
 * `{documentId, imageId, alt, mediaType}` in doc order — NO vectors. The caller
 * (media_runtime.rankMediaForDocs) fetches vectors from Qdrant and ranks in the
 * action. Excludes doc_link rows (never menu items) and url-less rows.
 */
export const mediaMetaForDocs = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    documentIds: v.array(v.id("documents"))
  },
  handler: async (ctx, args) => {
    const out: Array<{
      documentId: Id<"documents">
      imageId: string
      alt: string
      mediaType: "image" | "video"
    }> = []
    for (const documentId of args.documentIds) {
      const rows = await ctx.db
        .query("kbMedia")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", documentId))
        .collect()
      for (const r of rows) {
        if (r.kbId !== args.kbId || !r.url) continue
        const mediaType = (r.mediaType ?? "image") as
          | "image"
          | "video"
          | "doc_link"
        if (mediaType === "doc_link") continue
        out.push({ documentId, imageId: r.imageId, alt: r.alt, mediaType })
      }
    }
    return out
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
    const out: Array<{
      imageId: string
      url: string
      alt: string
      mediaType: "image" | "video" | "doc_link"
    }> = []
    for (const imageId of args.imageIds) {
      const row = await ctx.db
        .query("kbMedia")
        .withIndex("by_image_id", (q) => q.eq("imageId", imageId))
        .first()
      if (!row) continue
      if (!allowedKbs.has(row.kbId) || row.orgId !== args.orgId) continue // V3
      if (!row.url) continue // POC: url-only; storageId path is future D3→B
      out.push({
        imageId: row.imageId,
        url: row.url,
        alt: row.alt,
        mediaType: row.mediaType ?? "image"
      })
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
      .query("kbMedia")
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

/** List a KB's media (deduped by imageId) for the manual-context editor UI,
 *  tagged with the documents each media appears on (for grouping/filtering). */
export const listMediaForKb = tenantQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) return []
    const rows = await ctx.db
      .query("kbMedia")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    // Same media (url) can appear in several docs → one entry per imageId,
    // collecting all its source docs and preferring a manual-context row.
    const byId = new Map<
      string,
      {
        imageId: string
        alt: string
        url?: string
        mediaType: "image" | "video" | "doc_link"
        manualContext?: string
        docIds: Set<string>
      }
    >()
    for (const r of rows) {
      const prev = byId.get(r.imageId)
      if (!prev) {
        byId.set(r.imageId, {
          imageId: r.imageId,
          alt: r.alt,
          url: r.url,
          mediaType: r.mediaType ?? "image",
          manualContext: r.manualContext,
          docIds: new Set([r.sourceDocId])
        })
      } else {
        prev.docIds.add(r.sourceDocId)
        if (!prev.manualContext && r.manualContext)
          prev.manualContext = r.manualContext
      }
    }
    // Resolve document titles for the docs referenced by any media.
    const allDocIds = new Set<string>()
    for (const e of byId.values()) for (const d of e.docIds) allDocIds.add(d)
    const titleById = new Map<string, string>()
    for (const docId of allDocIds) {
      const doc = await ctx.db.get(docId as Id<"documents">)
      if (doc) titleById.set(docId, doc.title || doc.docId || docId)
    }
    return [...byId.values()].map((e) => ({
      imageId: e.imageId,
      alt: e.alt,
      url: e.url,
      mediaType: e.mediaType,
      manualContext: e.manualContext,
      docs: [...e.docIds].map((id) => ({
        id,
        title: titleById.get(id) ?? id
      }))
    }))
  }
})

/**
 * Set (or clear) user-authored context for a media item, then re-embed. Applies
 * to every row sharing the imageId in this KB (same media across docs), and
 * reschedules processing for each affected document so the new context takes
 * effect in ranking (highest-priority signal).
 */
export const setMediaContext = tenantMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    imageId: v.string(),
    manualContext: v.string()
  },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found")
    const rows = await ctx.db
      .query("kbMedia")
      .withIndex("by_image_id", (q) => q.eq("imageId", args.imageId))
      .collect()
    const mine = rows.filter((r) => r.kbId === args.kbId && r.orgId === orgId)
    if (mine.length === 0) throw new Error("Media not found")
    const trimmed = args.manualContext.trim()
    const docs = new Set<string>()
    for (const r of mine) {
      await ctx.db.patch(r._id, { manualContext: trimmed || undefined })
      docs.add(r.sourceDocId)
    }
    for (const docId of docs) {
      await scheduleDocImageProcessing(ctx, docId as Id<"documents">)
    }
    return { updated: mine.length }
  }
})
