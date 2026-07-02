"use node"

import { createHash } from "node:crypto"
import {
  parseMarkdownMedia,
  stripImageComments
} from "@tars-inc/eval-lib/file-processing/markdown-images"
import { createEmbedder } from "@tars-inc/eval-lib/llm"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { imageIdFor, isLikelyDecorativeImage } from "../lib/vision"
import { buildImageEmbeddingInput } from "../lib/visionShared"

/**
 * Document-level media processing (E1–E9). Reads the finalized document content
 * (E8), embeds each menu-eligible image/video (context-aware), mints no-embedding
 * `doc_link` pointers for embedded docs, writes one kbMedia row per item via
 * delete-and-replace (E2), and re-annotates the content (strip-then-reannotate,
 * E5): images/videos get a `<!--media:id-->` comment; doc embeds are rewritten to
 * an inline `[title](doc_id)` chunk-safe pointer. Decorative images stay visible
 * but get no row/annotation (E4).
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
    const media = parseMarkdownMedia(base)

    const embedder = createEmbedder()
    const seen = new Set<string>()
    // Ranked media (image/video) — embedded. doc_link — pointer, no embedding.
    const embedItems: Array<{
      imageId: string
      url: string
      alt: string
      mediaType: "image" | "video"
      input: string
      hash: string
    }> = []
    const docItems: Array<{ imageId: string; url: string; alt: string }> = []

    for (const m of media) {
      if (m.type === "image" && isLikelyDecorativeImage(m.url)) continue // E4
      const imageId = imageIdFor(kbId, m.url)
      if (seen.has(imageId)) continue
      seen.add(imageId)
      if (m.type === "doc_link") {
        docItems.push({ imageId, url: m.url, alt: m.alt || "document" })
        continue
      }
      const { alt, input } = buildImageEmbeddingInput(base, m)
      // Hash includes the model so switching embedders re-embeds (avoids
      // reusing a vector from a different model/dimension).
      const hash = createHash("sha256")
        .update(`${embedder.name}:${input}`)
        .digest("hex")
      embedItems.push({ imageId, url: m.url, alt, mediaType: m.type, input, hash })
    }

    // Reuse stored embeddings whose input+model hash is unchanged (skip the
    // OpenAI call); only embed new/changed items in one batch (E7). On embed
    // failure those rows are upserted without an embedding (E3).
    const prior = await ctx.runQuery(internal.kb.images.docImageEmbeddings, {
      sourceDocId: args.docId
    })
    const priorById = new Map(prior.map((p) => [p.imageId, p]))
    const embeddings: Array<number[] | undefined> = new Array(embedItems.length)
    const toCompute: number[] = []
    embedItems.forEach((e, i) => {
      const prev = priorById.get(e.imageId)
      if (prev?.embeddingInputHash === e.hash && prev.embedding) {
        embeddings[i] = prev.embedding // unchanged → reuse
      } else {
        toCompute.push(i)
      }
    })
    if (toCompute.length > 0) {
      try {
        const fresh = await embedder.embed(
          toCompute.map((i) => embedItems[i].input)
        )
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
      images: [
        ...embedItems.map((e, i) => ({
          imageId: e.imageId,
          url: e.url,
          alt: e.alt,
          mediaType: e.mediaType,
          embedding: embeddings[i],
          embeddingInputHash: e.hash
        })),
        ...docItems.map((e) => ({
          imageId: e.imageId,
          url: e.url,
          alt: e.alt,
          mediaType: "doc_link" as const
        }))
      ]
    })

    // Step 5: rewrite/annotate content (E4/E5).
    const idByUrl = new Map(
      [...embedItems, ...docItems].map((e) => [e.url, e.imageId])
    )
    // (a) doc embeds → chunk-safe inline pointer [title](doc_id) (kept in chunks).
    let out = base.replace(
      /\[embed:doc\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (raw, url: string, title?: string) => {
        const id = idByUrl.get(url)
        return id ? `[${title || "document"}](${id})` : raw
      }
    )
    // (b) images → append <!--media:id--> (decorative not in map → untouched).
    out = out.replace(
      /!\[[^\]]*\]\(([^)\s]+)\)/g,
      (raw, url: string) => {
        const id = idByUrl.get(url)
        return id ? `${raw}<!--media:${id}-->` : raw
      }
    )
    // (c) video embeds → append <!--media:id-->.
    out = out.replace(
      /\[embed:video\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (raw, url: string) => {
        const id = idByUrl.get(url)
        return id ? `${raw}<!--media:${id}-->` : raw
      }
    )
    await ctx.runMutation(internal.kb.images.setDocImageAnnotations, {
      docId: args.docId,
      content: out
    })
  }
})
