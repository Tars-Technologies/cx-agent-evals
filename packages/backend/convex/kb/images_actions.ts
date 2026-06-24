"use node"

import {
  parseMarkdownImages,
  stripImageComments
} from "@tars-inc/eval-lib/file-processing/markdown-images"
import { createEmbedder } from "@tars-inc/eval-lib/llm"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { imageIdFor, isLikelyDecorativeImage, recleanChunkImages } from "../lib/vision"
import { buildImageEmbeddingInput } from "../lib/visionShared"

/**
 * Re-parse every chunk in a KB for images and apply the current decorative
 * filter, WITHOUT re-embedding:
 *  - pre-feature raw ![alt](url) → mint ids, upsert kbImages, rewrite markers
 *  - already-rewritten ![alt](img_<id>) → drop ones that now read as decorative
 *    (icons/pins/logos), removing them from content, metadata, and kbImages
 * Idempotent: a second run finds nothing to change.
 */
/**
 * Document-level image processing (E1–E9). Reads the finalized document content
 * (E8), builds a context-aware embedding per menu-eligible image, writes one
 * kbImages row per image via delete-and-replace (E2), and re-annotates the
 * content with `<!--img:id-->` (strip-then-reannotate, E5). Decorative images
 * stay visible in content but get no row/annotation (E4).
 */
export const processDocImages = internalAction({
  args: { docId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.kb.documents.getInternal, {
      id: args.docId
    })
    const kbId = doc.kbId as string
    // Step 0: strip existing annotations, parse against clean content (E5).
    const base = stripImageComments(doc.content)
    const parsed = parseMarkdownImages(base) // already skips svg/data/non-http

    // Menu-eligible = parsed minus decorative (E4), preserving order.
    const eligible = parsed.filter((p) => !isLikelyDecorativeImage(p.url))

    // Build embedding inputs + mint ids (dedup by imageId within the doc).
    const seen = new Set<string>()
    const toEmbed: Array<{
      imageId: string
      url: string
      alt: string
      input: string
    }> = []
    for (const img of eligible) {
      const imageId = imageIdFor(kbId, img.url)
      if (seen.has(imageId)) continue
      seen.add(imageId)
      const { alt, input } = buildImageEmbeddingInput(base, img)
      toEmbed.push({ imageId, url: img.url, alt, input })
    }

    // Batched embed (E7); on failure, upsert without embeddings (E3).
    let embeddings: number[][] | null = null
    if (toEmbed.length > 0) {
      try {
        const embedder = createEmbedder()
        embeddings = await embedder.embed(toEmbed.map((e) => e.input))
      } catch {
        embeddings = null
      }
    }

    await ctx.runMutation(internal.kb.images.upsertDocImages, {
      kbId: doc.kbId,
      orgId: doc.orgId,
      sourceDocId: args.docId,
      images: toEmbed.map((e, i) => ({
        imageId: e.imageId,
        url: e.url,
        alt: e.alt,
        embedding: embeddings ? embeddings[i] : undefined
      }))
    })

    // Step 5: re-annotate menu images only (E4/E5).
    const urlToId = new Map(toEmbed.map((e) => [e.url, e.imageId]))
    const annotated = base.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (raw, _alt: string, url: string) => {
        const id = urlToId.get(url)
        return id ? `${raw}<!--img:${id}-->` : raw
      }
    )
    await ctx.runMutation(internal.kb.images.setDocImageAnnotations, {
      docId: args.docId,
      content: annotated
    })
  }
})

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
