"use node"

import { createHash } from "node:crypto"
import { assertPublicHttpUrl } from "@tars-inc/eval-lib/scraper"
import { normalizeUrl } from "@tars-inc/eval-lib/scraper/link-extractor"
import { tool } from "ai"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { MAX_IMAGES_PER_TURN } from "@tars-inc/eval-lib/multimodal"

// Re-export the pure helpers so action files can import everything from one
// module. They now live in @tars-inc/eval-lib/multimodal (moved out of the old
// local visionShared.ts); the node-only pieces below stay here.
export * from "@tars-inc/eval-lib/multimodal"

/**
 * Deterministic image ID: stable across re-index so saved answers keep
 * resolving. Space separator avoids kbId/url concatenation collisions.
 */
const MEDIA_ID_PREFIX = {
  image: "img",
  video: "vid",
  doc_link: "doc"
} as const

export function imageIdFor(
  kbId: string,
  url: string,
  type: "image" | "video" | "doc_link" = "image"
): string {
  const hash = createHash("sha256")
    .update(`${kbId} ${normalizeUrl(url)}`)
    .digest("hex")
  return `${MEDIA_ID_PREFIX[type]}_${hash.slice(0, 16)}`
}

// Drop tiny rendered images: icons, flags, location pins (e.g. Wikipedia's
// "12px-Red_pog.svg.png" location dot). Content images render much larger.
const MIN_IMAGE_WIDTH_PX = 100

// Common decorative/chrome image filenames (MediaWiki + general web). Matched
// case-insensitively against the URL; these are never answer-relevant content.
const DECORATIVE_NAME_RE =
  /(_pog\.|red_pog|green_pog|blue_pog|location_dot|disambig|commons-logo|wiktionary|wikidata|wikisource|wikiquote|wikinews|ooui_|oojs_|ambox|question_book|edit-icon|magnify-clip|cscr-featured|featured_article|sound-icon|speakerlink|symbol_|wiki_letter|increase2|decrease2|steady2|padlock|spoken_|favicon|sprite|spacer|placeholder|1x1|pixel\.)/i

// Path segments that conventionally hold non-content chrome (icons/logos/etc).
// Deliberately EXCLUDES "thumb" — MediaWiki serves real content images from
// "/thumb/" paths, so matching it would drop legitimate photos.
const DECORATIVE_PATH_RE =
  /\/(icons?|logos?|sprites?|emojis?|avatars?|badges?|favicons?|pictograms?)\//i

// True when a width/height query param is present and below the content floor
// (many CDNs honor ?w= / ?h= / &width= / &height=). Only fires on a clearly
// small explicit value, so it never guesses about params that aren't there.
function tooSmallByQuery(url: string): boolean {
  try {
    const u = new URL(url)
    for (const key of ["w", "width", "h", "height"]) {
      const raw = u.searchParams.get(key)
      if (raw === null) continue
      const val = Number(raw)
      if (Number.isFinite(val) && val > 0 && val < MIN_IMAGE_WIDTH_PX) return true
    }
  } catch {
    /* non-absolute or malformed url — the other signals still apply */
  }
  return false
}

/**
 * Heuristic: is this image decorative chrome (icon/flag/pin/logo) rather than
 * answer-relevant content? Keeps such images out of the agent's image menu so
 * it can't surface a stray location dot. This is the markdown/URL layer of a
 * two-layer filter — the HTML layer (html-to-markdown) drops chrome by
 * class/role/size before conversion; this layer catches what the URL reveals.
 */
export function isLikelyDecorativeImage(url: string): boolean {
  // MediaWiki/most CDNs encode the rendered width as "<N>px-" in thumb paths.
  const m = url.match(/\/(\d+)px-/)
  if (m && Number(m[1]) < MIN_IMAGE_WIDTH_PX) return true
  if (DECORATIVE_PATH_RE.test(url)) return true
  if (DECORATIVE_NAME_RE.test(url)) return true
  if (tooSmallByQuery(url)) return true
  return false
}

// Matches image markers the model writes referencing a KB image id.
// Matches media markers the model writes: image form `![alt](img_..)` AND plain
// link form `[text](img_..)` (doc pointers). The leading `!` is optional.
const IMG_MARKER_RE = /!?\[[^\]]*\]\(((?:img|vid|doc)_[0-9a-f]+)\)/g

// Defensive bound on distinct markers we resolve from a single answer. Each miss
// is one indexed DB lookup; a legit answer renders a handful, so this only caps
// pathological/adversarial output (a model spraying hundreds of fake ids), never
// real usage. Well above MENU_IMAGE_CAP so it can't clip a normal reply.
const MAX_RESOLVED_MARKERS = 24

/**
 * Build the resolved-image map for finalize whitelisting. Seeds with images the
 * model fetched via get_images (pixels seen), then resolves any remaining
 * `img_` markers the model wrote inline — straight from the retrieved chunk
 * content — against the KB registry (org+kb scoped). This lets a relevant image
 * render even when the model skipped the get_images call, while hallucinated /
 * external / cross-KB targets still resolve to nothing and get dropped (V4/V9).
 */
export async function resolveAnswerImageMarkers(
  ctx: ActionCtx,
  scope: { kbIds: Array<Id<"knowledgeBases">>; orgId: string },
  text: string,
  seed: Map<string, { url: string; alt: string }>
): Promise<Map<string, { url: string; alt: string }>> {
  const merged = new Map(seed)
  const missing = new Set<string>()
  for (const m of text.matchAll(IMG_MARKER_RE)) {
    if (!merged.has(m[1])) missing.add(m[1])
    if (missing.size >= MAX_RESOLVED_MARKERS) break
  }
  if (missing.size > 0 && scope.kbIds.length > 0) {
    const rows: Array<{ imageId: string; url: string; alt: string }> =
      await ctx.runQuery(internal.kb.images.getImagesByIds, {
        kbIds: scope.kbIds,
        orgId: scope.orgId,
        imageIds: [...missing]
      })
    for (const r of rows) merged.set(r.imageId, { url: r.url, alt: r.alt })
  }
  return merged
}

// Cap the bytes we base64 into the model context. Kept well under provider
// limits because base64 of a large original can blow the context window (a
// multi-megapixel image expands to hundreds of thousands of tokens).
const MAX_IMAGE_BYTES = 1_500_000
// Clamp width/height query params many CDNs honor (NASA, WordPress, etc.) so we
// fetch a sane-sized variant instead of a 4800px original.
const MAX_IMAGE_DIMENSION = 1280

/** Lightweight tool result — NO pixel bytes (this value gets persisted). */
interface ResolvedImageRef {
  imageId: string
  url: string
  alt: string
  mediaType?: "image" | "video" | "doc_link"
}

/**
 * Fetch an image's bytes as base64, guarded against SSRF (https/http public
 * hosts only; loopback/private/metadata blocked). Returns null on any failure
 * so the model degrades to text (imageId + alt) rather than the turn erroring.
 */
/** Clamp CDN width/height query params so we don't fetch a giant original. */
function clampImageDimensions(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    let changed = false
    for (const key of ["w", "h", "width", "height"]) {
      const val = u.searchParams.get(key)
      if (val && Number(val) > MAX_IMAGE_DIMENSION) {
        u.searchParams.set(key, String(MAX_IMAGE_DIMENSION))
        changed = true
      }
    }
    return changed ? u.href : rawUrl
  } catch {
    return rawUrl
  }
}

export async function fetchImageAsBase64(
  rawUrl: string
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const url = assertPublicHttpUrl(clampImageDimensions(rawUrl))
    const res = await fetch(url, { redirect: "error" })
    if (!res.ok) return null
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim()
    if (!mimeType || !mimeType.startsWith("image/")) return null
    // Skip oversized files up front (before buffering the body) when the server
    // advertises the size. Chunked responses omit Content-Length, so the
    // post-download byte check below stays as the backstop.
    const declared = Number(res.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return { data: buf.toString("base64"), mimeType }
  } catch {
    return null
  }
}

/**
 * Build the get_images tool. It validates requested ids against kbMedia
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
  scope: { kbIds: Array<Id<"knowledgeBases">>; orgId: string },
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
        { kbIds: scope.kbIds, orgId: scope.orgId, imageIds: capped }
      )
      // Record the validated ids/urls so finalize can whitelist the answer.
      onResolved(resolved)
      // Fetch pixels ONLY for images — videos/docs have no pixels and a giant
      // original would blow the context, so we never fetch them here.
      await Promise.all(
        resolved.map(async (r) => {
          if ((r.mediaType ?? "image") !== "image") return
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
        const kind = r.mediaType ?? "image"
        if (kind !== "image") {
          // Video/doc: no pixels. Steer the model to embed via the marker.
          parts.push({
            type: "text",
            text: `imageId: ${r.imageId} — ${kind === "video" ? "VIDEO" : "DOCUMENT"} "${r.alt}". This has no pixels to view — do NOT try to fetch it; write the marker ![alt](${r.imageId}) to embed it.`
          })
          continue
        }
        const bytes = fetchedBytes.get(r.imageId)
        parts.push({
          type: "text",
          text: `imageId: ${r.imageId} — alt: ${r.alt}${bytes ? "" : " (image too large or unavailable to preview; you may still embed it with ![alt](imageId))"}`
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
