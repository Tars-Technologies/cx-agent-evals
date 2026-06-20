"use node"

import { createHash } from "node:crypto"
import {
  parseMarkdownImages,
  rewriteMarkdownImages
} from "@tars-inc/eval-lib/file-processing/markdown-images"
import { assertPublicHttpUrl } from "@tars-inc/eval-lib/scraper"
import { normalizeUrl } from "@tars-inc/eval-lib/scraper/link-extractor"
import { tool } from "ai"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { MAX_IMAGES_PER_TURN } from "./visionShared"

// Re-export pure helpers so action files can import everything from one module.
export * from "./visionShared"

/**
 * Deterministic image ID: stable across re-index so saved answers keep
 * resolving. Space separator avoids kbId/url concatenation collisions.
 */
export function imageIdFor(kbId: string, url: string): string {
  const hash = createHash("sha256")
    .update(`${kbId} ${normalizeUrl(url)}`)
    .digest("hex")
  return `img_${hash.slice(0, 16)}`
}

/**
 * Parse images from a chunk's content, mint deterministic ids, rewrite the
 * inline ![alt](url) → ![alt](img_<id>) marker (position preserved, no pixels),
 * and return the rewritten content + the {imageId,url,alt} list to persist.
 * Shared by ingestion (indexing_actions) and the backfill action.
 */
export function extractChunkImages(kbId: string, content: string) {
  const parsed = parseMarkdownImages(content)
  if (parsed.length === 0) {
    return {
      content,
      images: [] as Array<{ imageId: string; url: string; alt: string }>
    }
  }
  const images: Array<{ imageId: string; url: string; alt: string }> = []
  const seen = new Set<string>()
  const rewritten = rewriteMarkdownImages(content, ({ alt, url }) => {
    // rewriteMarkdownImages invokes map for every complete match, including
    // unsupported targets; only menu-eligible (parsed) urls get an id.
    if (!parsed.some((p) => p.url === url)) return url // leave unsupported untouched
    const imageId = imageIdFor(kbId, url)
    if (!seen.has(imageId)) {
      seen.add(imageId)
      images.push({ imageId, url, alt })
    }
    return imageId
  })
  return { content: rewritten, images }
}

// Skip oversized images (provider limits ≈5MB; we also bill for what we send).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** A resolved image with optionally-fetched pixel bytes for the vision model. */
interface ResolvedImageWithData {
  imageId: string
  url: string
  alt: string
  /** base64-encoded bytes, present only when the fetch succeeded. */
  data?: string
  mimeType?: string
}

/**
 * Fetch an image's bytes as base64, guarded against SSRF (https/http public
 * hosts only; loopback/private/metadata blocked). Returns null on any failure
 * so the model degrades to text (imageId + alt) rather than the turn erroring.
 */
async function fetchImageAsBase64(
  rawUrl: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const url = assertPublicHttpUrl(rawUrl)
    const res = await fetch(url, { redirect: "error" })
    if (!res.ok) return null
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim()
    if (!mimeType || !mimeType.startsWith("image/")) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return { data: buf.toString("base64"), mimeType }
  } catch {
    return null
  }
}

/**
 * Build the get_images tool. It validates requested ids against kbImages
 * (org+kb scoped, V3), caps at MAX_IMAGES_PER_TURN (V7), fetches pixels so a
 * vision model can see them, and records every returned id via `onResolved`
 * so finalize can whitelist against it (V4).
 *
 * AI SDK v4 tool-result image parts require base64 `data` (not a URL), so we
 * fetch + encode server-side in `execute` and surface the pixels via
 * `experimental_toToolResultContent`. Images that fail to fetch still return
 * their id + alt as text so the model can reference them by id.
 */
export function buildGetImagesTool(
  ctx: ActionCtx,
  scope: { kbId: Id<"knowledgeBases">; orgId: string },
  onResolved: (
    resolved: Array<{ imageId: string; url: string; alt: string }>
  ) => void
) {
  return tool({
    description:
      "Fetch knowledge-base images by their imageIds so you can see them and decide whether to include them in your answer. Returns the images plus the imageIds you may reference as ![alt](imageId).",
    parameters: z.object({
      imageIds: z
        .array(z.string())
        .describe("imageIds from the retrieved image menu (max 4 used)")
    }),
    execute: async ({ imageIds }): Promise<ResolvedImageWithData[]> => {
      const capped = imageIds.slice(0, MAX_IMAGES_PER_TURN)
      const resolved: Array<{ imageId: string; url: string; alt: string }> =
        await ctx.runQuery(internal.kb.images.getImagesByIds, {
          kbId: scope.kbId,
          orgId: scope.orgId,
          imageIds: capped
        })
      // Record the validated ids/urls so finalize can whitelist the answer.
      onResolved(resolved)
      // Fetch pixels so a vision model can actually inspect each image.
      return Promise.all(
        resolved.map(async (r): Promise<ResolvedImageWithData> => {
          const fetched = await fetchImageAsBase64(r.url)
          return {
            imageId: r.imageId,
            url: r.url,
            alt: r.alt,
            ...(fetched ?? {})
          }
        })
      )
    },
    // Map the fetched bytes into multimodal tool-result content (v4 shape).
    experimental_toToolResultContent: (result: ResolvedImageWithData[]) => {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType?: string }
      > = []
      for (const r of result) {
        parts.push({
          type: "text",
          text: `imageId: ${r.imageId} — alt: ${r.alt}${r.data ? "" : " (image could not be fetched; reference by id only)"}`
        })
        if (r.data) {
          parts.push({ type: "image", data: r.data, mimeType: r.mimeType })
        }
      }
      if (parts.length === 0) {
        parts.push({
          type: "text",
          text: "No images matched the requested imageIds."
        })
      }
      return parts
    }
  })
}
