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
import type { ActionCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { imageIdFor, isLikelyDecorativeImage } from "../lib/vision"
import { buildImageEmbeddingInput } from "@tars-inc/eval-lib/multimodal"
import { buildQdrantMediaStore } from "./media_runtime"

/**
 * Document-level media processing (E1–E9). Reads the finalized document content
 * (E8), embeds each menu-eligible image/video (context-aware), mints no-embedding
 * `doc_link` pointers for embedded docs, and writes one kbMedia row per item via
 * delete-and-replace (E2). The doc→media mapping lives in kbMedia (by_source_doc),
 * so images/videos are NOT annotated into the content — only `[embed:doc]` tokens
 * are rewritten to an inline `[title](doc_id)` chunk-safe pointer (kept in chunks
 * so the agent can cite it). Decorative images stay visible but get no row (E4).
 * The outcome is recorded on the document via setMediaStatus (done/failed) so a
 * Qdrant/embed outage is observable rather than lost to Workpool retries.
 */
export const processDocImages = internalAction({
  args: { docId: v.id("documents") },
  handler: async (ctx, args) => {
    try {
      // A soft embed/upsert outage is swallowed inside processDoc (rows still get
      // written; vectors retry on the next reprocess) but reported back here so it
      // surfaces as "failed" instead of a misleading "done" with missing vectors.
      const { embedError } = await processDoc(ctx, args.docId)
      await ctx.runMutation(internal.kb.images.setMediaStatus, {
        docId: args.docId,
        status: embedError ? "failed" : "done",
        error: embedError
      })
    } catch (err: any) {
      // A hard failure (Qdrant delete, a mutation, etc.) aborted the run. Record
      // it, then rethrow so Workpool retries; after retries exhaust the "failed"
      // status + message remains visible instead of vanishing silently.
      await ctx.runMutation(internal.kb.images.setMediaStatus, {
        docId: args.docId,
        status: "failed",
        error: String(err?.message ?? err).slice(0, 500)
      })
      throw err
    }
  }
})

async function processDoc(
  ctx: ActionCtx,
  docId: Id<"documents">
): Promise<{ embedError?: string }> {
  const doc = await ctx.runQuery(internal.kb.documents.getInternal, {
    id: docId
  })
  const kbId = doc.kbId as string
  // Step 0: strip existing annotations, parse against clean content (E5).
  const base = stripImageComments(doc.content)
  const media = parseMarkdownMedia(base)

  // Existing rows carry user-authored manualContext (must survive re-scrape,
  // and dominates the embedding) + prior input hashes for the skip-reembed
  // check (a matching hash means the vector is already in Qdrant).
  const prior = await ctx.runQuery(internal.kb.images.docMediaPriorMeta, {
    sourceDocId: docId
  })
  const priorById = new Map(prior.map((p) => [p.imageId, p]))

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
    manualContext?: string
  }> = []
  const docItems: Array<{ imageId: string; url: string; alt: string }> = []

  for (const m of media) {
    if (m.type === "image" && isLikelyDecorativeImage(m.url)) continue // E4
    const imageId = imageIdFor(kbId, m.url, m.type)
    if (seen.has(imageId)) continue
    seen.add(imageId)
    if (m.type === "doc_link") {
      docItems.push({ imageId, url: m.url, alt: m.alt || "document" })
      continue
    }
    const manualContext = priorById.get(imageId)?.manualContext
    const { alt, input } = buildImageEmbeddingInput(base, m, manualContext)
    // Hash includes the model so switching embedders re-embeds (avoids
    // reusing a vector from a different model/dimension).
    const hash = createHash("sha256")
      .update(`${embedder.name}:${input}`)
      .digest("hex")
    embedItems.push({
      imageId,
      url: m.url,
      alt,
      mediaType: m.type,
      input,
      hash,
      manualContext
    })
  }

  // Skip items whose input+model hash is unchanged — a matching hash means the
  // vector is already in Qdrant (skip both the OpenAI call and the re-upsert).
  // Only new/changed items are (re)embedded in one batch (E7). On embed failure
  // the item's hash is left undefined so the next run recomputes (E3).
  const toCompute: number[] = []
  const succeededHash = new Array<string | undefined>(embedItems.length)
  embedItems.forEach((e, i) => {
    const prev = priorById.get(e.imageId)
    if (prev?.embeddingInputHash === e.hash) {
      succeededHash[i] = e.hash // unchanged → vector already upserted
    } else {
      toCompute.push(i)
    }
  })

  // Vectors live in Qdrant. Delete only the media this doc no longer
  // references (leaving unchanged points intact), then upsert (re)embedded
  // media. Point ids are derived from imageId, so upsert is idempotent. The
  // collection is created at the embedder's dimension so vectors always fit.
  // Only build the store when there's actually something to delete/upsert — a
  // text-only doc (the common case) has nothing for Qdrant to do at all.
  const currentIds = new Set(embedItems.map((e) => e.imageId))
  const removedIds = prior
    .map((p) => p.imageId)
    .filter((id) => !currentIds.has(id))
  const store =
    removedIds.length > 0 || toCompute.length > 0
      ? buildQdrantMediaStore(embedder.dimension)
      : null
  if (store && removedIds.length > 0) {
    await store.deleteByIds(removedIds)
  }

  let embedError: string | undefined
  if (store && toCompute.length > 0) {
    try {
      const fresh = await embedder.embed(
        toCompute.map((i) => embedItems[i].input)
      )
      await store.upsert(
        toCompute.map((idx, j) => ({
          imageId: embedItems[idx].imageId,
          embedding: fresh[j],
          alt: embedItems[idx].alt,
          mediaType: embedItems[idx].mediaType
        })),
        {
          kbId: String(doc.kbId),
          orgId: String(doc.orgId),
          sourceDocId: String(docId)
        }
      )
      // Mark these as successfully vectorized so the row records the hash.
      for (const idx of toCompute) succeededHash[idx] = embedItems[idx].hash
    } catch (e: any) {
      // Soft-fail: leave the changed entries' hashes undefined so the next run
      // recomputes them, but report the outage so the caller marks the document
      // "failed" rather than a misleading "done" with missing vectors (E3).
      embedError = String(e?.message ?? e).slice(0, 500)
    }
  }

  await ctx.runMutation(internal.kb.images.upsertDocImages, {
    kbId: doc.kbId,
    orgId: doc.orgId,
    sourceDocId: docId,
    images: [
      ...embedItems.map((e, i) => ({
        imageId: e.imageId,
        url: e.url,
        alt: e.alt,
        mediaType: e.mediaType,
        embeddingInputHash: succeededHash[i],
        manualContext: e.manualContext
      })),
      ...docItems.map((e) => ({
        imageId: e.imageId,
        url: e.url,
        alt: e.alt,
        mediaType: "doc_link" as const
      }))
    ]
  })

  // Step 5: rewrite doc embeds to chunk-safe inline pointers `[title](doc_id)`,
  // which are intentionally KEPT in chunk text so the agent can cite them. This
  // rewrite is idempotent (a rewritten `[title](doc_id)` no longer matches the
  // `[embed:doc]` pattern) and runs only for docs that contain doc embeds.
  //
  // Images/videos are deliberately NOT annotated. The doc→media mapping lives in
  // kbMedia (`by_source_doc`), so injecting `<!--media:id-->` markers would serve
  // no purpose — nothing reads them back — while shifting every downstream
  // character offset and desyncing ground-truth spans / chunk positions from
  // `doc.content`. `base` already stripped any legacy markers, so existing docs
  // self-heal on reprocess.
  const idByUrl = new Map(docItems.map((e) => [e.url, e.imageId]))
  const out = base.replace(
    /\[embed:doc\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (raw, url: string, title?: string) => {
      const id = idByUrl.get(url)
      return id ? `[${title || "document"}](${id})` : raw
    }
  )
  await ctx.runMutation(internal.kb.images.setDocImageAnnotations, {
    docId,
    content: out
  })

  return { embedError }
}
