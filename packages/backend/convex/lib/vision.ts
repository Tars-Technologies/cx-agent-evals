"use node"

import { createHash } from "node:crypto"
import {
  isUnsupportedImageUrl,
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

// Drop tiny rendered images: icons, flags, location pins (e.g. Wikipedia's
// "12px-Red_pog.svg.png" location dot). Content images render much larger.
const MIN_IMAGE_WIDTH_PX = 100

// Common decorative/chrome image filenames (MediaWiki + general web). Matched
// case-insensitively against the URL; these are never answer-relevant content.
const DECORATIVE_NAME_RE =
  /(_pog\.|red_pog|green_pog|blue_pog|location_dot|disambig|commons-logo|wiktionary|wikidata|wikisource|wikiquote|wikinews|ooui_|oojs_|ambox|question_book|edit-icon|magnify-clip|cscr-featured|featured_article|sound-icon|speakerlink|symbol_|wiki_letter|increase2|decrease2|steady2|padlock|spoken_)/i

/**
 * Heuristic: is this image decorative chrome (icon/flag/pin/logo) rather than
 * answer-relevant content? Keeps such images out of the agent's image menu so
 * it can't surface a stray location dot. URL is the only signal available at
 * the markdown layer (turndown drops width/height attrs).
 */
export function isLikelyDecorativeImage(url: string): boolean {
  // MediaWiki/most CDNs encode the rendered width as "<N>px-" in thumb paths.
  const m = url.match(/\/(\d+)px-/)
  if (m && Number(m[1]) < MIN_IMAGE_WIDTH_PX) return true
  if (DECORATIVE_NAME_RE.test(url)) return true
  return false
}

/**
 * Parse images from a chunk's content, mint deterministic ids, rewrite the
 * inline ![alt](url) → ![alt](img_<id>) marker (position preserved, no pixels),
 * and return the rewritten content + the {imageId,url,alt} list to persist.
 * Decorative/tiny images are dropped from the content entirely so they never
 * reach the model. Shared by ingestion (indexing_actions) and the backfill.
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
    if (isLikelyDecorativeImage(url)) return null // drop icons/pins/logos
    const imageId = imageIdFor(kbId, url)
    if (!seen.has(imageId)) {
      seen.add(imageId)
      images.push({ imageId, url, alt })
    }
    return imageId
  })
  return { content: rewritten, images }
}

/**
 * Re-clean a chunk's images, handling BOTH pre-feature raw ![alt](url) markers
 * AND already-rewritten ![alt](img_<id>) markers. Used by the backfill so an
 * existing KB picks up the decorative filter without a full re-embed:
 *  - raw url → mint id (unless decorative/unsupported)
 *  - img_ id → resolve via imgIdToUrl; drop if it now reads as decorative
 * `changed` is true only when something was actually rewritten/dropped
 * (idempotent: a second pass over a clean chunk reports no change).
 */
export function recleanChunkImages(
  kbId: string,
  content: string,
  imgIdToUrl: Map<string, string>
) {
  const keptImages: Array<{ imageId: string; alt: string }> = []
  const newImages: Array<{ imageId: string; url: string; alt: string }> = []
  const droppedIds: string[] = []
  const seenKept = new Set<string>()
  const seenNew = new Set<string>()
  let changed = false

  const next = rewriteMarkdownImages(content, ({ alt, url }) => {
    if (url.startsWith("img_")) {
      const realUrl = imgIdToUrl.get(url)
      if (realUrl && isLikelyDecorativeImage(realUrl)) {
        droppedIds.push(url)
        changed = true
        return null
      }
      if (!seenKept.has(url)) {
        seenKept.add(url)
        keptImages.push({ imageId: url, alt })
      }
      return url // keep existing good marker unchanged
    }
    // Pre-feature raw url.
    if (isUnsupportedImageUrl(url)) return url // leave svg/data/non-http alone
    if (isLikelyDecorativeImage(url)) {
      changed = true
      return null
    }
    const imageId = imageIdFor(kbId, url)
    if (!seenNew.has(imageId)) {
      seenNew.add(imageId)
      newImages.push({ imageId, url, alt })
    }
    changed = true
    return imageId
  })

  return { content: next, keptImages, newImages, droppedIds, changed }
}

// Skip oversized images (provider limits ≈5MB; we also bill for what we send).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Lightweight tool result — NO pixel bytes (this value gets persisted). */
interface ResolvedImageRef {
  imageId: string
  url: string
  alt: string
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
 * `experimental_toToolResultContent`. The base64 is kept ONLY in an in-memory
 * map — never in the tool's return value — so the persisted tool_result rows
 * (and replayed history) stay small and contain just {imageId,url,alt}. When
 * images move to dedicated storage later, this fetch/encode step is all that
 * changes. Images that fail to fetch still return id + alt so the model can
 * reference them by id.
 */
export function buildGetImagesTool(
  ctx: ActionCtx,
  scope: { kbId: Id<"knowledgeBases">; orgId: string },
  onResolved: (
    resolved: Array<{ imageId: string; url: string; alt: string }>
  ) => void
) {
  // Transient pixel cache for this tool instance; consumed by
  // experimental_toToolResultContent, then discarded when the action ends.
  const fetchedBytes = new Map<string, { data: string; mimeType?: string }>()
  return tool({
    description:
      "Fetch knowledge-base images by their imageIds so you can see them and decide whether to include them in your answer. Returns the images plus the imageIds you may reference as ![alt](imageId).",
    parameters: z.object({
      imageIds: z
        .array(z.string())
        .describe("imageIds from the retrieved image menu (max 4 used)")
    }),
    execute: async ({ imageIds }): Promise<ResolvedImageRef[]> => {
      const capped = imageIds.slice(0, MAX_IMAGES_PER_TURN)
      const resolved: ResolvedImageRef[] = await ctx.runQuery(
        internal.kb.images.getImagesByIds,
        { kbId: scope.kbId, orgId: scope.orgId, imageIds: capped }
      )
      // Record the validated ids/urls so finalize can whitelist the answer.
      onResolved(resolved)
      // Fetch pixels into the transient map (NOT into the return value) so the
      // model can see them without the base64 ever being persisted.
      await Promise.all(
        resolved.map(async (r) => {
          const fetched = await fetchImageAsBase64(r.url)
          if (fetched) fetchedBytes.set(r.imageId, fetched)
        })
      )
      return resolved // { imageId, url, alt } only — small, safe to store
    },
    // Map the cached bytes into multimodal tool-result content (v4 shape).
    experimental_toToolResultContent: (result: ResolvedImageRef[]) => {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType?: string }
      > = []
      for (const r of result) {
        const bytes = fetchedBytes.get(r.imageId)
        parts.push({
          type: "text",
          text: `imageId: ${r.imageId} — alt: ${r.alt}${bytes ? "" : " (image could not be fetched; reference by id only)"}`
        })
        if (bytes) {
          parts.push({ type: "image", data: bytes.data, mimeType: bytes.mimeType })
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
