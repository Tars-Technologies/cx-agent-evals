"use node"

import { createHash } from "node:crypto"
import {
  parseMarkdownImages,
  stripImageComments
} from "@tars-inc/eval-lib/file-processing/markdown-images"
import { createEmbedder } from "@tars-inc/eval-lib/llm"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { imageIdFor, isLikelyDecorativeImage } from "../lib/vision"
import { buildImageEmbeddingInput } from "../lib/visionShared"

/**
 * Document-level image processing (E1–E9). Reads the finalized document content
 * (E8), builds a context-aware embedding per menu-eligible image, writes one
 * kbMedia row per image via delete-and-replace (E2), and re-annotates the
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
    const embedder = createEmbedder()
    const seen = new Set<string>()
    const items: Array<{
      imageId: string
      url: string
      alt: string
      input: string
      hash: string
    }> = []
    for (const img of eligible) {
      const imageId = imageIdFor(kbId, img.url)
      if (seen.has(imageId)) continue
      seen.add(imageId)
      const { alt, input } = buildImageEmbeddingInput(base, img)
      // Hash includes the model so switching embedders re-embeds (avoids
      // reusing a vector from a different model/dimension).
      const hash = createHash("sha256")
        .update(`${embedder.name}:${input}`)
        .digest("hex")
      items.push({ imageId, url: img.url, alt, input, hash })
    }

    // Reuse stored embeddings whose input+model hash is unchanged (skip the
    // OpenAI call); only embed new/changed images in one batch (E7). On embed
    // failure those rows are upserted without an embedding (E3).
    const prior = await ctx.runQuery(internal.kb.images.docImageEmbeddings, {
      sourceDocId: args.docId
    })
    const priorById = new Map(prior.map((p) => [p.imageId, p]))
    const embeddings: Array<number[] | undefined> = new Array(items.length)
    const toCompute: number[] = []
    items.forEach((e, i) => {
      const prev = priorById.get(e.imageId)
      if (prev?.embeddingInputHash === e.hash && prev.embedding) {
        embeddings[i] = prev.embedding // unchanged → reuse
      } else {
        toCompute.push(i)
      }
    })
    if (toCompute.length > 0) {
      try {
        const fresh = await embedder.embed(toCompute.map((i) => items[i].input))
        toCompute.forEach((idx, j) => {
          embeddings[idx] = fresh[j]
        })
      } catch {
        // leave the changed entries' embeddings undefined; retried next run
      }
    }

    await ctx.runMutation(internal.kb.images.upsertDocImages, {
      kbId: doc.kbId,
      orgId: doc.orgId,
      sourceDocId: args.docId,
      images: items.map((e, i) => ({
        imageId: e.imageId,
        url: e.url,
        alt: e.alt,
        embedding: embeddings[i],
        embeddingInputHash: e.hash
      }))
    })

    // Step 5: re-annotate menu images only (E4/E5).
    const urlToId = new Map(items.map((e) => [e.url, e.imageId]))
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
