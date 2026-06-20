"use node"

import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { extractChunkImages } from "../lib/vision"

/**
 * Re-parse every chunk in a KB for images: mint ids, upsert kbImages, rewrite
 * inline ![alt](url) → ![alt](img_<id>), patch metadata.images. Idempotent:
 * after the first run chunk content holds ![alt](img_xxxx); img_ targets are
 * non-http so parseMarkdownImages skips them and a second run is a no-op.
 */
export const backfillImagesForKb = internalAction({
  args: { kbId: v.id("knowledgeBases"), orgId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.runQuery(internal.kb.images.listChunkIdsForKb, {
      kbId: args.kbId
    })
    let updated = 0
    for (const chunk of chunks) {
      const { content, images } = extractChunkImages(args.kbId, chunk.content)
      if (images.length === 0) continue
      await ctx.runMutation(internal.kb.images.upsertImagesForChunk, {
        kbId: args.kbId,
        orgId: args.orgId,
        sourceDocId: chunk.documentId,
        images
      })
      await ctx.runMutation(internal.kb.images.patchChunkImages, {
        chunkId: chunk.id,
        content,
        images: images.map((i) => ({ imageId: i.imageId, alt: i.alt }))
      })
      updated++
    }
    return { updated }
  }
})
