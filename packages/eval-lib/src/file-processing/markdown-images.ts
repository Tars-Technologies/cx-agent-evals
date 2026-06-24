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
// closing paren. Partial syntax (no closing paren) simply won't match — which is
// exactly the chunk-boundary-split tolerance we want.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

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
  return content.replace(IMAGE_RE, (_raw, alt: string, url: string) => {
    const next = map({ alt, url })
    if (next === null) return ""
    return `![${alt}](${next})`
  })
}

/** Matches the non-rendering image-id annotation `<!--img:img_xxxx-->`. */
const IMG_COMMENT_RE = /<!--img:[^>]*-->/g

/** Remove `<!--img:...-->` annotations, leaving the surrounding text intact. */
export function stripImageComments(content: string): string {
  return content.replace(IMG_COMMENT_RE, "")
}

/**
 * Remove all complete `![alt](url)` images AND `<!--img:...-->` annotations,
 * producing clean text for chunking. Order matters: drop comments first so a
 * stripped image never leaves a dangling annotation behind.
 */
export function stripImageMarkdown(content: string): string {
  return stripImageComments(content).replace(IMAGE_RE, "")
}
