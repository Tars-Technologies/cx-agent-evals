/**
 * Pure multimodal media-retrieval helpers — no Node-only deps, safe to import
 * from anywhere (backend mutations/queries, prompt templates, tests). The
 * node-only / Convex-coupled pieces (imageIdFor, buildGetImagesTool, etc.) live
 * in the consuming backend, not here.
 */

import {
  rewriteMarkdownImages,
  type MarkdownImage
} from "../file-processing/markdown-images.js"

export const MAX_IMAGES_PER_TURN = 4
export const MENU_IMAGE_CAP = 6
// Max images one document may contribute when the candidate pool spans more than
// one document (B5). A single-document pool is exempt (option b) — see
// rankDocImagesForQuery.
export const PER_DOC_IMAGE_CAP = 2
// Cosine floor below which an image is treated as off-topic and excluded (B4).
// Conservative starting value for text-embedding-3-small alt embeddings; tune
// once image-retrieval metrics exist.
export const MIN_IMAGE_SIMILARITY = 0.2

/**
 * Hardcoded allowlist of vision-capable models.
 * @deprecated Fallback for consumers without a capability catalog.
 */
export const VISION_CAPABLE_MODELS = [
  // Claude (Anthropic) — all 4.x are multimodal
  "claude-opus-4-8",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  // OpenAI — 4.1 family, 4o family, and o-series are multimodal
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "o3",
  "o4-mini"
]

/**
 * Check if a model is vision capable using the hardcoded allowlist.
 * @deprecated Fallback for consumers without a capability catalog. Primary gate should check catalog capabilities instead.
 */
export function isVisionCapable(modelId: string): boolean {
  return VISION_CAPABLE_MODELS.includes(modelId)
}

/**
 * Appended to the agent system prompt when the retrieval menu carries media.
 */
export function mediaSystemPromptRules(opts: {
  menuPresent: boolean
  visionCapable: boolean
}): string {
  if (!opts.menuPresent) return ""
  const lines = [
    "## Media",
    "- Before you refuse or decline a request to see/show/view an image, map, photo, video, or document — or say you are a text-only model — you MUST first search the knowledge base. It may contain a real one you can actually display. Only fall back to a text refusal if that search finds nothing relevant.",
    "The knowledge tool result may include an `images` menu of {imageId, alt, type}.",
    "- Copy an `imageId` VERBATIM from the menu — never invent, guess, abbreviate, or reformat one.",
    "- To display media, write `![alt](imageId)` inline — the id, never a raw URL. Prose alone shows nothing; only the marker renders it.",
    "- Only ever use an `imageId` from the menu as the target. Never copy a URL you see written in retrieved passages/chunk/article/source text (e.g. an image link inside the retrieved content) and use that as an image source — such a URL is not guaranteed real or safe to display and will be removed.",
    "- NEVER construct or guess a URL from general/training knowledge (e.g. a plausible-looking Wikipedia/Wikimedia file URL) — even if it looks real, it is not one you retrieved and it WILL be silently removed from your answer. The imageId is the only valid target, always.",
    "  WRONG: `![dancer](https://upload.wikimedia.org/wikipedia/commons/thumb/...)`  (a real-looking but non-menu URL — always stripped)",
    "  WRONG: `![dancer](img_4e0bd074cbe4876a)`  (this exact id is only a FORMAT example — it is not real and does not exist; using it verbatim will fail)",
    "  RIGHT: `![dancer](<imageId>)` — replace <imageId> with the REAL id string copied from THIS turn's menu, not from this instruction text.",
    "- Video items embed a real, playable video via the marker — never say you cannot show a video or send the user elsewhere.",
    "- Doc links found in retrieved chunk text (`[title](doc_id)`) may be cited verbatim.",
    "- If there is no menu, do not fabricate media."
  ]
  if (opts.visionCapable) {
    lines.push(
      "- You can call `get_images(imageIds)` to actually see an image before showing it; if it returns nothing for an id, that id did not exist — do not retry with a guessed id."
    )
  }
  return lines.join("\n")
}

/** @deprecated Use mediaSystemPromptRules instead */
export const IMAGE_INSTRUCTIONS = mediaSystemPromptRules({
  menuPresent: true,
  visionCapable: true
})

export interface ImageMenuEntry {
  imageId: string
  alt: string
  /** "image" | "video" | "doc_link" — tells the agent whether to fetch pixels, emit a link, or cite a doc. */
  type?: "image" | "video" | "doc_link"
}

// ─── Context-aware embedding input (D10) ───

const ALT_DENYLIST = new Set([
  "image",
  "photo",
  "figure",
  "screenshot",
  "logo",
  "banner",
  "icon",
  "img",
  "graphic",
  "picture",
  ""
])
const HEADING_DENYLIST = new Set([
  "Overview",
  "Introduction",
  "Summary",
  "Background",
  "About",
  "Details",
  "More",
  "Content",
  "Section"
])
const SURROUNDING_CHARS = 300
// How many times manual context is repeated in the embedding input, to weight it
// above the scraped signals (higher = manual context dominates the match more).
const MANUAL_CONTEXT_WEIGHT = 3
const CAPTION_KEYWORD_RE = /^(Figure|Fig\.|Caption:|Source:|Photo:)/i
const HEADING_RE = /^(#{2,3})\s+(.+)$/gm

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

// Lightweight local strip so surrounding text never carries image syntax.
// Must tolerate an optional `"title"` tail like stripImageMarkdown's IMAGE_RE
// does — otherwise a titled image adjacent to the one being processed fails to
// match and its raw `![alt](url "title")` leaks into the surrounding-text
// fallback signal.
function stripImageMarkdownInline(s: string): string {
  return s
    .replace(/<!--img:[^>]*-->/g, "")
    .replace(/!\[[^\]]{0,2000}\]\([^)\s]+(?:\s+"[^"]*")?\)/g, "")
}

/** Nearest `##`/`###` heading text above `pos`, or "". */
function nearestHeadingAbove(content: string, pos: number): string {
  let heading = ""
  for (const m of content.matchAll(HEADING_RE)) {
    if ((m.index ?? 0) < pos) heading = m[2].trim()
    else break
  }
  return heading
}

/**
 * The caption line immediately after the image (skipping at most one blank
 * line). `strong` when italic / caption-keyword / <figcaption>; weak otherwise
 * (a short, single-sentence plain line).
 */
function captionAfter(
  content: string,
  img: MarkdownImage
): { text: string; strong: boolean } {
  const after = content.slice(img.index + img.raw.length)
  const lines = after.split("\n")
  // lines[0] is the remainder of the image's own line (usually empty).
  let i = 1
  if (i < lines.length && lines[i].trim() === "") i++ // skip one blank line
  const line = (lines[i] ?? "").trim()
  if (!line) return { text: "", strong: false }
  const isItalic = /^\*[^*].*\*$/.test(line) || /^_[^_].*_$/.test(line)
  const isKeyword = CAPTION_KEYWORD_RE.test(line)
  const isFigcaption = /^<figcaption>/i.test(line)
  if (isItalic || isKeyword || isFigcaption) {
    return {
      text: line
        .replace(/^[*_]|[*_]$/g, "")
        .replace(/<\/?figcaption>/gi, "")
        .trim(),
      strong: true
    }
  }
  // weak: short single-sentence plain line
  if (line.length < 100 && !/[.!?].+[.!?]/.test(line)) {
    return { text: line, strong: false }
  }
  return { text: "", strong: false }
}

/** N chars before+after the image, bounded to the current section. */
function surrounding(content: string, img: MarkdownImage): string {
  let sectionStart = 0
  let sectionEnd = content.length
  for (const m of content.matchAll(HEADING_RE)) {
    const at = m.index ?? 0
    if (at <= img.index) sectionStart = at
    else {
      sectionEnd = at
      break
    }
  }
  const before = content.slice(
    Math.max(sectionStart, img.index - SURROUNDING_CHARS),
    img.index
  )
  const afterStart = img.index + img.raw.length
  const after = content.slice(
    afterStart,
    Math.min(sectionEnd, afterStart + SURROUNDING_CHARS)
  )
  return stripImageMarkdownInline(`${before} ${after}`).replace(/\s+/g, " ").trim()
}

/**
 * Build the context-aware embedding input for one image (D10). Returns the
 * effective alt (placeholder when empty), the assembled input string, and
 * whether surrounding text was folded in (only when all signals are weak).
 *
 * `manualContext`, when present (non-blank), is BLENDED in as the leading,
 * highest-priority signal — it heads the input so it dominates the vector, while
 * the scraped signals still contribute.
 */
export function buildImageEmbeddingInput(
  content: string,
  img: MarkdownImage,
  manualContext?: string
): { alt: string; input: string; usedSurrounding: boolean } {
  const alt = img.alt.trim() === "" ? "image" : img.alt.trim()

  // Scraped, context-aware signals (D10).
  const caption = captionAfter(content, img)
  const heading = nearestHeadingAbove(content, img.index)

  const altOk = wordCount(alt) >= 2 && !ALT_DENYLIST.has(alt.toLowerCase())
  const captionOk = caption.strong
  const headingOk = wordCount(heading) >= 2 && !HEADING_DENYLIST.has(heading)

  // A weak caption is only used when alt is also weak (per D10).
  const captionText = captionOk || !altOk ? caption.text : ""
  // Gate alt/heading through their denylist checks so generic tokens ("image",
  // "Overview", …) never leak into the embedding support signal (D10) — only
  // strong signals contribute; the surrounding-text fallback covers the rest.
  const parts = [captionText, altOk ? alt : "", headingOk ? heading : ""].filter(
    Boolean
  )

  let scraped: string
  let usedSurrounding: boolean
  if (altOk || captionOk || headingOk) {
    scraped = parts.join(". ")
    usedSurrounding = false
  } else {
    scraped = [...parts, surrounding(content, img)].filter(Boolean).join(". ")
    usedSurrounding = true
  }

  // Blend, with manual context guaranteed to dominate regardless of how long the
  // scraped text is. Two levers make the weighting RELATIVE, not absolute:
  //  (1) drop the bulky surrounding-text fallback — the user's context replaces
  //      that weak signal; keep only the short strong signals (caption/alt/heading).
  //  (2) cap that support to the manual context's own length, then repeat the
  //      manual context MANUAL_CONTEXT_WEIGHT×. So manual is always ≥ ~W/(W+1) of
  //      the input by volume (≈75% at W=3), even if the raw scraped text was huge.
  const manual = manualContext?.trim()
  if (!manual) {
    // scraped can be "" (no strong signals, no surrounding text — e.g. a bare
    // image with no alt/caption/heading next to other stripped images). Never
    // hand OpenAI's embeddings endpoint an empty string: it 400s the whole
    // batch, which poisons every sibling media item in this doc.
    return { alt, input: scraped || alt || img.url, usedSurrounding }
  }
  const support = parts.join(". ").slice(0, manual.length)
  const weighted = Array(MANUAL_CONTEXT_WEIGHT).fill(manual).join(". ")
  const input = [weighted, support].filter(Boolean).join(". ")
  return { alt, input, usedSurrounding: false }
}

// ─── Doc-gated round-robin ranking (E9) ───

export interface DocImage {
  imageId: string
  alt: string
  embedding?: number[]
  type?: "image" | "video" | "doc_link"
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/**
 * Build the doc-gated image menu. `docGroups` are pre-ordered by document
 * relevance (best retrieved-chunk rank first).
 *
 * Normal path (at least one image has a usable embedding — present and matching
 * the query dimension): drop images below `MIN_IMAGE_SIMILARITY` (B4) and any
 * un-scoreable image, sort the rest by cosine desc, then select highest-first
 * with a per-document cap (B5) and global dedup, up to `cap`.
 *
 * Fallback path (no usable embedding — e.g. a non-default retriever's dimension
 * mismatches, or embeds failed): cosine is meaningless, so ignore the threshold
 * and select in document order, still applying the per-document cap and dedup.
 *
 * The per-document cap is `PER_DOC_IMAGE_CAP` only when the eligible pool spans
 * more than one document; a single-document pool is exempt (option b) so one
 * relevant document may fill the whole menu.
 */
export function rankScoredImages(
  cands: {
    imageId: string
    alt: string
    type?: "image" | "video" | "doc_link"
    docIdx: number
    order: number
    score: number | null
  }[],
  cap: number
): ImageMenuEntry[] {
  const anyUsable = cands.some((c) => c.score !== null)
  const pool = anyUsable
    ? cands
        .filter((c) => c.score !== null && c.score! >= MIN_IMAGE_SIMILARITY)
        .sort((a, b) => b.score! - a.score! || a.order - b.order)
    : cands.slice().sort((a, b) => a.order - b.order)

  // Per-doc cap only guards cross-document domination, so it is skipped when the
  // eligible pool comes from a single document (option b).
  const distinctDocs = new Set(pool.map((c) => c.docIdx)).size
  const perDocCap = distinctDocs > 1 ? PER_DOC_IMAGE_CAP : cap

  const out: ImageMenuEntry[] = []
  const seen = new Set<string>()
  const perDocCount = new Map<number, number>()
  for (const c of pool) {
    if (out.length >= cap) break
    if (seen.has(c.imageId)) continue
    const used = perDocCount.get(c.docIdx) ?? 0
    if (used >= perDocCap) continue
    seen.add(c.imageId)
    perDocCount.set(c.docIdx, used + 1)
    out.push({ imageId: c.imageId, alt: c.alt, type: c.type ?? "image" })
  }
  return out
}

export function rankDocImagesForQuery(
  queryEmbedding: number[],
  docGroups: DocImage[][],
  cap: number
): ImageMenuEntry[] {
  const candidates: {
    imageId: string
    alt: string
    type?: "image" | "video" | "doc_link"
    docIdx: number
    order: number
    score: number | null
  }[] = []
  let order = 0
  docGroups.forEach((group, docIdx) => {
    for (const img of group) {
      const usable =
        !!img.embedding && img.embedding.length === queryEmbedding.length
      candidates.push({
        imageId: img.imageId,
        alt: img.alt,
        type: img.type,
        docIdx,
        order: order++,
        score: usable ? cosine(queryEmbedding, img.embedding!) : null
      })
    }
  })
  return rankScoredImages(candidates, cap)
}

// Matches media markers referencing a KB media id, in either image form
// `![alt](img_..)` or plain-link form `[text](doc_..)` (the leading `!` is
// optional). An optional `"title"` may follow the id — whitelistImageMarkdown's
// underlying IMAGE_RE tolerates one, so this must too, or a titled marker the
// model wrote still renders but silently drops out of parseRenderedMediaIds.
// Kept in sync with the backend vision.ts's private IMG_MARKER_RE — this pure
// copy lets non-node callers (evaluation, agentLoop) parse markers too.
const MEDIA_MARKER_RE =
  /!?\[[^\]]*\]\(((?:img|vid|doc)_[0-9a-f]+)(?:\s+"[^"]*")?\)/g

/**
 * Return the KB media ids referenced by markers actually written in `text`
 * (before finalize rewrites them to real URLs). Order-preserving, de-duplicated.
 * "Rendered" = the model wrote the marker, i.e. the user will see this media —
 * as opposed to media it merely fetched via get_images but chose not to embed.
 */
export function parseRenderedMediaIds(text: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(MEDIA_MARKER_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      ids.push(m[1])
    }
  }
  return ids
}

// Matches a markdown link `[text](target)` that is NOT an image (`![...]`).
const LINK_MARKER_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g

/**
 * Finalize guard (V4/V9): keep only images whose target is a resolved imageId,
 * rewriting them to the real URL; everything else (hallucinated ids, raw external
 * urls) is removed. THEN, additively, rewrite plain link markers `[text](id)`
 * whose target is a known media id (doc pointers) to the real URL.
 *
 * Video/doc handling is consumer-dependent, so it is opt-in via
 * `opts.stripNonImages` (default `false`) — the lib does not hardcode one
 * consumer's render policy:
 *   - `false` (default): a resolved video/doc marker is rewritten to its inline
 *     URL, same as an image. Correct for consumers that render media directly
 *     from markdown (e.g. an `![alt](url)` → `<video>`/link renderer).
 *   - `true`: a resolved video/doc marker is stripped from the text and its id
 *     collected in `strippedIds`, so the caller can emit a structured render
 *     part (e.g. a ContentPart player/chip) in its place. The caller owns that
 *     emission; the lib stays render-agnostic.
 *
 * `strippedIds` is always returned (empty when nothing was stripped).
 */
export function whitelistImageMarkdown(
  text: string,
  resolved: Map<string, { url: string; alt: string; type?: "image" | "video" | "doc_link" }>,
  opts: { stripNonImages?: boolean } = {}
): { text: string; strippedIds: string[] } {
  const stripNonImages = opts.stripNonImages ?? false
  const stripped = new Set<string>()
  const isNonImage = (type?: string) => type === "video" || type === "doc_link"

  const imagesRewritten = rewriteMarkdownImages(text, ({ url }) => {
    // `url` here is whatever the model wrote in (...) — an imageId or a real url.
    const hit = resolved.get(url)
    if (hit) {
      if (stripNonImages && isNonImage(hit.type)) {
        stripped.add(url)
        return null // strips the image marker; caller renders it as a part
      }
      return hit.url
    }
    return null // strips unknown/hallucinated targets
  })

  const textRewritten = imagesRewritten.replace(
    LINK_MARKER_RE,
    (raw, linkText: string, target: string) => {
      const hit = resolved.get(target)
      if (hit) {
        if (stripNonImages && isNonImage(hit.type)) {
          stripped.add(target)
          return "" // strips the link marker; caller renders it as a part
        }
        return `[${linkText}](${hit.url})` // resolve-known-only
      }
      return raw // leave other links untouched
    }
  )

  return {
    text: textRewritten,
    strippedIds: Array.from(stripped)
  }
}
