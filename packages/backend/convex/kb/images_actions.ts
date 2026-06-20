"use node"

import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { recleanChunkImages } from "../lib/vision"

/**
 * Re-parse every chunk in a KB for images and apply the current decorative
 * filter, WITHOUT re-embedding:
 *  - pre-feature raw ![alt](url) → mint ids, upsert kbImages, rewrite markers
 *  - already-rewritten ![alt](img_<id>) → drop ones that now read as decorative
 *    (icons/pins/logos), removing them from content, metadata, and kbImages
 * Idempotent: a second run finds nothing to change.
 */
export const backfillImagesForKb = internalAction({
  args: { kbId: v.id("knowledgeBases"), orgId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.runQuery(internal.kb.images.listChunkIdsForKb, {
      kbId: args.kbId
    })
    const urlPairs = await ctx.runQuery(internal.kb.images.imageUrlMapForKb, {
      kbId: args.kbId
    })
    const imgIdToUrl = new Map(urlPairs.map((r) => [r.imageId, r.url]))

    let updated = 0
    let dropped = 0
    for (const chunk of chunks) {
      const { content, keptImages, newImages, droppedIds, changed } =
        recleanChunkImages(args.kbId, chunk.content, imgIdToUrl)
      if (!changed) continue

      if (newImages.length > 0) {
        await ctx.runMutation(internal.kb.images.upsertImagesForChunk, {
          kbId: args.kbId,
          orgId: args.orgId,
          sourceDocId: chunk.documentId,
          images: newImages
        })
      }
      if (droppedIds.length > 0) {
        await ctx.runMutation(internal.kb.images.deleteKbImagesByIds, {
          kbId: args.kbId,
          imageIds: droppedIds
        })
        dropped += droppedIds.length
      }
      await ctx.runMutation(internal.kb.images.patchChunkImages, {
        chunkId: chunk.id,
        content,
        images: [
          ...keptImages,
          ...newImages.map((i) => ({ imageId: i.imageId, alt: i.alt }))
        ]
      })
      updated++
    }
    return { updated, dropped }
  }
})
