/** A complete markdown image occurrence parsed from text. */
export interface MarkdownImage {
  alt: string
  url: string
  /** The full matched `![alt](url)` substring. */
  raw: string
  /** Start offset of `raw` within the source string. */
  index: number
}

// Complete, non-greedy markdown image. Alt may be empty; url stops at the first
// space or closing paren; an optional `"title"` may follow. Partial syntax (no
// closing paren) simply won't match — which is exactly the chunk-boundary-split
// tolerance we want.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

/** True for targets a vision model cannot consume or that aren't fetchable URLs. */
export function isUnsupportedImageUrl(url: string): boolean {
  const u = url.trim().toLowerCase()
  if (u.startsWith("data:")) return true
  if (!u.startsWith("http://") && !u.startsWith("https://")) return true
  // Strip query/fragment before checking the extension.
  const path = u.split(/[?#]/)[0]
  if (path.endsWith(".svg")) return true
  return false
}

/** Parse every complete, supported markdown image from `content`. */
export function parseMarkdownImages(content: string): MarkdownImage[] {
  const out: MarkdownImage[] = []
  for (const m of content.matchAll(IMAGE_RE)) {
    const url = m[2]
    if (isUnsupportedImageUrl(url)) continue
    out.push({
      alt: m[1],
      url,
      raw: m[0],
      index: m.index ?? 0
    })
  }
  return out
}

/**
 * Replace every complete markdown image. `map` receives {alt,url}; return a new
 * target string to rewrite `![alt](newTarget)`, or `null` to remove the whole
 * `![alt](url)` occurrence. `map` is invoked for every complete match (including
 * unsupported targets) so callers can drop raw external URLs as an injection
 * guard at finalize time.
 */
export function rewriteMarkdownImages(
  content: string,
  map: (img: { alt: string; url: string }) => string | null
): string {
  return content.replace(
    IMAGE_RE,
    (_raw, alt: string, url: string, title?: string) => {
      const next = map({ alt, url })
      if (next === null) return ""
      return title !== undefined
        ? `![${alt}](${next} "${title}")`
        : `![${alt}](${next})`
    }
  )
}

/** Matches the non-rendering media-id annotation `<!--media:img_xxxx-->`
 *  (and the legacy `<!--img:...-->` form). */
const IMG_COMMENT_RE = /<!--(?:img|media):[^>]*-->/g

/** Remove media annotations, leaving the surrounding text intact. */
export function stripImageComments(content: string): string {
  return content.replace(IMG_COMMENT_RE, "")
}

/**
 * Remove all complete `![alt](url)` images AND media annotations, producing clean
 * text for chunking. Order matters: drop comments first so a stripped image never
 * leaves a dangling annotation behind.
 */
export function stripImageMarkdown(content: string): string {
  return stripImageComments(content).replace(IMAGE_RE, "")
}

// ─── Generic media (image / video / doc) ───

export type MediaType = "image" | "video" | "doc_link"

/** A complete media occurrence (image, embedded video, or embedded doc). */
export interface MarkdownMedia {
  type: MediaType
  alt: string
  url: string
  /** The full matched substring. */
  raw: string
  /** Start offset of `raw` within the source string. */
  index: number
}

// Normalized non-image embeds carried through markdown (which has no native
// video/doc syntax): [embed:video](url "optional title") / [embed:doc](url "...").
const EMBED_RE = /\[embed:(video|doc)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g
// The video token alone, for stripping from chunks (doc tokens are rewritten to
// plain links before chunking, so they are not matched here).
const VIDEO_EMBED_RE = /\[embed:video\]\([^)\s]+(?:\s+"[^"]*")?\)/g

/** Parse every image, video, and doc-embed occurrence, in document order. */
export function parseMarkdownMedia(content: string): MarkdownMedia[] {
  const out: MarkdownMedia[] = []
  for (const m of content.matchAll(IMAGE_RE)) {
    if (isUnsupportedImageUrl(m[2])) continue
    out.push({
      type: "image",
      alt: m[1],
      url: m[2],
      raw: m[0],
      index: m.index ?? 0
    })
  }
  for (const m of content.matchAll(EMBED_RE)) {
    out.push({
      type: m[1] === "video" ? "video" : "doc_link",
      alt: m[3] ?? "",
      url: m[2],
      raw: m[0],
      index: m.index ?? 0
    })
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * Strip image + video tokens and media annotations, producing clean chunk text.
 * Doc pointers (`[title](img_id)` plain links) are intentionally KEPT so the agent
 * can cite them — they are not part of the ranked media menu.
 */
export function stripMediaMarkdown(content: string): string {
  return stripImageComments(content)
    .replace(IMAGE_RE, "")
    .replace(VIDEO_EMBED_RE, "")
}
