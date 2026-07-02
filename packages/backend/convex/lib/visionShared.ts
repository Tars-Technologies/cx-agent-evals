/**
 * Pure vision helpers — no Node-only deps, importable from mutations, queries,
 * the pure promptTemplate, and tests. The node-only pieces (imageIdFor,
 * buildGetImagesTool) live in `vision.ts`, which re-exports everything here.
 */

import {
  rewriteMarkdownImages,
  type MarkdownImage
} from "@tars-inc/eval-lib/file-processing/markdown-images"

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

// Explicit allowlist — resolveModel routes by id but has no vision check.
// Must track the model menu in AgentConfigPanel.tsx: every selectable model
// here is vision-capable, so the toggle works regardless of which one is
// picked. Add new model ids here when the dropdown gains them.
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

export function isVisionCapable(modelId: string): boolean {
  return VISION_CAPABLE_MODELS.includes(modelId)
}

/** Appended to the system prompt only when hasVision (V6). */
export const IMAGE_INSTRUCTIONS = `# Images & media
The search results include a ranked list of media drawn from the relevant documents — each entry has an \`imageId\`, an \`alt\`/label, and a \`type\` (\`image\` or \`video\`). Every real imageId begins with \`img_\` (e.g. \`img_3f9a2c1b4d5e6f70\`).

When the retrieved results include an image relevant to your answer (a screenshot, diagram, photo, UI, map, or chart), you SHOULD show it — default to including a clearly relevant image rather than leaving it out.

For a \`type: "video"\` entry, do NOT call \`get_images\` (there are no pixels to view); if the video is clearly relevant, write the marker \`![alt](imageId)\` to embed it. Some retrieved chunk text also contains inline document links written as \`[title](img_...)\` — you may include such a link verbatim when it helps; do not call \`get_images\` for it.

To show an image to the user:
1. Call the \`get_images\` tool, passing imageIds copied EXACTLY from the retrieved image menu (you may request up to ${MAX_IMAGES_PER_TURN}).
2. After it returns, write \`![alt](imageId)\` exactly where you want each image to appear in your answer, using only imageIds the tool actually returned.

Rules:
- ONLY pass imageIds that literally appear in the retrieved results (they start with \`img_\`). Copy them character-for-character. NEVER invent, guess, abbreviate, or reformat an imageId or URL.
- If the retrieved results contain NO image menu, do not call \`get_images\` and do not include any image — just answer in text. An empty \`get_images\` result means the id did not exist; never retry with a made-up id.
- If a retrieved image is on-topic, include it — a relevant screenshot or diagram makes the answer much more useful. After calling \`get_images\`, look at what each image actually depicts and skip any that don't clearly help — never include decorative icons, logos, flags, location pins/dots, charts you can't read, or images unrelated to the question.
- When in doubt about a clearly on-topic image, include it; only skip images that are off-topic or decorative.
- To actually show an image you MUST write the marker ![alt](imageId) inline in your answer. Never just say "here is an image" without the marker — a sentence alone shows nothing.
- Do not write raw external image URLs; use the imageId form only.`

export interface ImageMenuEntry {
  imageId: string
  alt: string
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
const CAPTION_KEYWORD_RE = /^(Figure|Fig\.|Caption:|Source:|Photo:)/i
const HEADING_RE = /^(#{2,3})\s+(.+)$/gm

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

// Lightweight local strip so surrounding text never carries image syntax.
function stripImageMarkdownInline(s: string): string {
  return s.replace(/<!--img:[^>]*-->/g, "").replace(/!\[[^\]]*\]\([^)\s]+\)/g, "")
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
 */
export function buildImageEmbeddingInput(
  content: string,
  img: MarkdownImage
): { alt: string; input: string; usedSurrounding: boolean } {
  const alt = img.alt.trim() === "" ? "image" : img.alt.trim()
  const caption = captionAfter(content, img)
  const heading = nearestHeadingAbove(content, img.index)

  const altOk = wordCount(alt) >= 2 && !ALT_DENYLIST.has(alt.toLowerCase())
  const captionOk = caption.strong
  const headingOk = wordCount(heading) >= 3 && !HEADING_DENYLIST.has(heading)

  // A weak caption is only used when alt is also weak (per D10).
  const captionText = captionOk || !altOk ? caption.text : ""
  const parts = [captionText, alt, heading].filter(Boolean)

  if (altOk || captionOk || headingOk) {
    return { alt, input: parts.join(". "), usedSurrounding: false }
  }
  const surr = surrounding(content, img)
  return {
    alt,
    input: [...parts, surr].filter(Boolean).join(". "),
    usedSurrounding: true
  }
}

// ─── Doc-gated round-robin ranking (E9) ───

export interface DocImage {
  imageId: string
  alt: string
  embedding?: number[]
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
export function rankDocImagesForQuery(
  queryEmbedding: number[],
  docGroups: DocImage[][],
  cap: number
): ImageMenuEntry[] {
  interface Candidate {
    imageId: string
    alt: string
    docIdx: number
    order: number
    score: number | null
  }
  const candidates: Candidate[] = []
  let order = 0
  docGroups.forEach((group, docIdx) => {
    for (const img of group) {
      const usable =
        !!img.embedding && img.embedding.length === queryEmbedding.length
      candidates.push({
        imageId: img.imageId,
        alt: img.alt,
        docIdx,
        order: order++,
        score: usable ? cosine(queryEmbedding, img.embedding!) : null
      })
    }
  })

  const anyUsable = candidates.some((c) => c.score !== null)
  const pool = anyUsable
    ? candidates
        .filter((c) => c.score !== null && c.score >= MIN_IMAGE_SIMILARITY)
        .sort((a, b) => b.score! - a.score! || a.order - b.order)
    : candidates.slice().sort((a, b) => a.order - b.order)

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
    out.push({ imageId: c.imageId, alt: c.alt })
  }
  return out
}

// Matches a markdown link `[text](target)` that is NOT an image (`![...]`).
const LINK_MARKER_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g

/**
 * Finalize guard (V4/V9): keep only images whose target is a resolved imageId,
 * rewriting them to the real URL; everything else (hallucinated ids, raw external
 * urls) is removed. THEN, additively, rewrite plain link markers `[text](id)`
 * whose target is a known media id (doc pointers) to the real URL.
 *
 * The two passes are intentionally asymmetric: the image pass DROPS unknown
 * targets (injection guard); the link pass is resolve-known-only and leaves every
 * other link untouched — the model writes legitimate hyperlinks to real URLs all
 * the time, so we must never drop or mangle them.
 */
export function whitelistImageMarkdown(
  text: string,
  resolved: Map<string, { url: string; alt: string }>
): string {
  const imagesRewritten = rewriteMarkdownImages(text, ({ url }) => {
    // `url` here is whatever the model wrote in (...) — an imageId or a real url.
    const hit = resolved.get(url)
    return hit ? hit.url : null
  })
  return imagesRewritten.replace(
    LINK_MARKER_RE,
    (raw, linkText: string, target: string) => {
      const hit = resolved.get(target)
      return hit ? `[${linkText}](${hit.url})` : raw // resolve-known-only
    }
  )
}
