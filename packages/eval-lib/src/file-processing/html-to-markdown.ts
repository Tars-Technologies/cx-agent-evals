export interface HtmlToMarkdownOptions {
  onlyMainContent?: boolean
  baseUrl?: string
}

export interface HtmlToMarkdownResult {
  content: string
  title: string
  links: string[]
}

const BOILERPLATE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  ".cookie-banner",
  ".cookie-consent",
  "#cookie-banner",
  "#cookie-consent",
  ".gdpr",
  "#gdpr",
  "script",
  "style",
  "noscript"
  // NOTE: <iframe> is intentionally NOT blanket-removed here — the media-capture
  // pass below converts allowlisted video/doc embeds to markdown tokens and
  // removes everything else. Removing it here would drop videos/docs before capture.
]

// Video players we can safely iframe-embed downstream; others are dropped.
const VIDEO_EMBED_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com|wistia\.com|wistia\.net)$/i
// Doc viewers captured as pointer links (never ingested).
const DOC_VIEWER_HOSTS =
  /(^|\.)(docs\.google\.com|view\.officeapps\.live\.com|onedrive\.live\.com)$/i

function hostOf(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return ""
  }
}

// Render size below which an <img> is treated as a non-content icon/spacer.
const MIN_CONTENT_IMG_PX = 100
// class/id tokens that conventionally name decorative chrome images.
const DECORATIVE_CLASS_RE =
  /\b(icons?|logos?|avatars?|emojis?|badges?|sprites?|pictograms?|favicons?)\b/i

// Read a pixel dimension attribute ("120", "120px") → number, or null if absent
// or non-numeric (e.g. width="100%", which is not a decorative signal).
function pxAttr(el: any, name: string): number | null {
  const raw = el.getAttribute?.(name)
  if (!raw) return null
  const n = Number(String(raw).replace(/px$/i, "").trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Decisive HTML-layer decorative test for an <img>. Fires only on strong
 * signals so genuine content images (which carry none of these) survive:
 * author-declared presentation, decorative class/id naming, an explicitly small
 * render size, or a 1x1 tracking pixel.
 */
function isDecorativeImgElement(img: any): boolean {
  if ((img.getAttribute?.("aria-hidden") || "").toLowerCase() === "true")
    return true
  if ((img.getAttribute?.("role") || "").toLowerCase() === "presentation")
    return true
  const naming = `${img.getAttribute?.("class") || ""} ${img.getAttribute?.("id") || ""}`
  if (DECORATIVE_CLASS_RE.test(naming)) return true
  const w = pxAttr(img, "width")
  const h = pxAttr(img, "height")
  if (w === 1 && h === 1) return true // tracking pixel
  if (w !== null && w > 0 && w < MIN_CONTENT_IMG_PX) return true
  if (h !== null && h > 0 && h < MIN_CONTENT_IMG_PX) return true
  return false
}

export async function htmlToMarkdown(
  html: string,
  options?: HtmlToMarkdownOptions
): Promise<HtmlToMarkdownResult> {
  const linkedomMod = await import("linkedom")
  const parseHTML: (html: string) => { document: any } =
    (linkedomMod as any).parseHTML ?? (linkedomMod as any).default?.parseHTML

  const turndownMod = await import("turndown")
  const TurndownService = (turndownMod as any).default ?? turndownMod

  const onlyMainContent = options?.onlyMainContent ?? true
  const baseUrl = options?.baseUrl
  const { document: doc } = parseHTML(html) as { document: any }

  const links = extractLinks(doc, baseUrl)
  let title: string = doc.querySelector("title")?.textContent?.trim() || ""
  const h1Title: string = doc.querySelector("h1")?.textContent?.trim() || ""
  let htmlForConversion: string

  if (onlyMainContent) {
    for (const selector of BOILERPLATE_SELECTORS) {
      const elements = doc.querySelectorAll(selector)
      for (const el of elements) {
        el.remove()
      }
    }
    // Drop decorative <img> chrome (icons/logos/spacers/tracking pixels) before
    // conversion, using DOM signals turndown would otherwise discard (class,
    // role, aria-hidden, width/height attrs). Only decisive signals fire, so
    // real content images — which carry none of these — are left untouched.
    for (const img of doc.querySelectorAll("img")) {
      if (isDecorativeImgElement(img)) img.remove()
    }
  }

  // Resolve relative <img src> against the page base URL so stored markdown
  // carries absolute, fetchable image URLs (turndown does NOT resolve img src;
  // it only resolved anchor hrefs via extractLinks). This is the single change
  // that makes crawled images usable by the multimodal agent path.
  if (baseUrl) {
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src")
      if (!src) continue
      try {
        img.setAttribute("src", new URL(src, baseUrl).href)
      } catch {
        /* leave malformed src untouched */
      }
    }
  }

  htmlForConversion = doc.body?.innerHTML || html

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced"
  })

  // Media capture (via a turndown rule, not a DOM pass): rule outputs are inserted
  // verbatim — no markdown escaping of the token brackets — and the rule can read
  // attributes turndown otherwise discards. Allowlisted video/doc embeds become
  // normalized tokens; everything else (ads/maps/trackers) is dropped.
  const absolutize = (u: string): string => {
    try {
      return baseUrl ? new URL(u, baseUrl).href : u
    } catch {
      return u
    }
  }
  const titleOf = (node: any): string =>
    (node.getAttribute?.("title") || node.getAttribute?.("aria-label") || "").trim()
  // Both interpolated verbatim into `[embed:x](url "title")` — a `"` in the title
  // would close the quote early and a `)` in the url would close the link target
  // early, letting page content corrupt the token structure of ingested markdown.
  const escapeTitle = (s: string): string => s.replace(/"/g, "'")
  const safeUrl = (u: string): string => u.replace(/\)/g, "%29")

  turndown.addRule("mediaEmbed", {
    filter: (node: any) =>
      node.nodeName === "IFRAME" || node.nodeName === "VIDEO",
    replacement: (_content: string, node: any): string => {
      if (node.nodeName === "IFRAME") {
        const raw = node.getAttribute("src")
        if (!raw) return ""
        const abs = absolutize(raw)
        const host = hostOf(abs)
        const path = abs.split(/[?#]/)[0].toLowerCase()
        const title = escapeTitle(titleOf(node))
        if (VIDEO_EMBED_HOSTS.test(host))
          return `\n\n[embed:video](${safeUrl(abs)} "${title}")\n\n`
        if (DOC_VIEWER_HOSTS.test(host) || path.endsWith(".pdf"))
          return `\n\n[embed:doc](${safeUrl(abs)} "${title}")\n\n`
        return "" // non-allowlisted iframe — dropped
      }
      // <video>: use src or the first <source src>, direct mp4/webm only.
      const src =
        node.getAttribute("src") ||
        node.querySelector?.("source")?.getAttribute("src") ||
        ""
      if (!src) return ""
      const abs = absolutize(src)
      if (/\.(mp4|webm)(\?|#|$)/i.test(abs))
        return `\n\n[embed:video](${safeUrl(abs)} "${escapeTitle(titleOf(node))}")\n\n`
      return ""
    }
  })

  let markdown = turndown.turndown(htmlForConversion)
  markdown = cleanupMarkdown(markdown)

  // Title priority: <title> tag > original h1 > first markdown heading
  if (!title) {
    title = h1Title
  }
  if (!title) {
    const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m)
    if (headingMatch) title = headingMatch[1]
  }

  return { content: markdown, title, links }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLinks(doc: any, baseUrl?: string): string[] {
  const anchors = doc.querySelectorAll("a[href]")
  const links: string[] = []
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href")
    if (!href || href.startsWith("#") || href.startsWith("javascript:"))
      continue
    try {
      const resolved = baseUrl ? new URL(href, baseUrl).href : href
      links.push(resolved)
    } catch {
      /* skip malformed URLs */
    }
  }
  return [...new Set(links)]
}

function cleanupMarkdown(md: string): string {
  return md
    .replace(/<!-- .*? -->/gs, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
}
