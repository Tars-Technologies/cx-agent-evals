"use client"

import {
  type ComponentPropsWithoutRef,
  type ReactElement,
  useState
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"

/** Strip non-standard tags (e.g. <last>, <party>) while preserving standard HTML.
 *  Extends defaultSchema with elements not in the GitHub-style allowlist. */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "abbr", "sub", "sup"]
}

interface MarkdownViewerProps {
  content: string
  className?: string
  /** If true, show the raw/rendered toggle. Default: true */
  showToggle?: boolean
  /** Override the default mode. Default: "rendered" */
  defaultMode?: "raw" | "rendered"
}

type Mode = "raw" | "rendered"

/** Non-rendering media-id annotations added at scrape time (Component 5):
 *  invisible in rendered output, shown verbatim in raw mode. */
const IMG_COMMENT_RE = /<!--(?:img|media):[^>]*-->/g

// Video providers we can safely iframe-embed (embed-form URLs only).
const VIDEO_EMBED_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com|wistia\.com|wistia\.net)$/i

function hostOf(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return ""
  }
}

/**
 * Prepare document content for rendered display: strip media annotations, and
 * convert the scrape-time embed tokens into renderable markdown so the preview
 * actually embeds them instead of showing the raw `[embed:video](...)` token.
 * `[embed:video]` → `![title](url)` (the img renderer's video branch handles it);
 * `[embed:doc]` → a plain `[title](url)` link.
 */
function prepareRendered(content: string): string {
  return content
    .replace(IMG_COMMENT_RE, "")
    .replace(
      /\[embed:video\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_r, url: string, title?: string) => `![${title ?? ""}](${url})`
    )
    .replace(
      /\[embed:doc\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_r, url: string, title?: string) => `[${title || "document"}](${url})`
    )
}

/** Extract a YouTube video id from an embed/watch/short URL, or "". */
function youTubeId(u: string): string {
  const m = u.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{6,})/
  )
  return m ? m[1] : ""
}

/**
 * Video renderer. For YouTube we show a derived poster thumbnail with a play
 * overlay and load the (sandboxed) iframe only on click — faster and avoids
 * auto-loading the tracking player (V6). Other allowlisted providers iframe
 * directly.
 */
function VideoEmbed({ url, alt }: { url: string; alt?: string }) {
  const [playing, setPlaying] = useState(false)
  const ytId = youTubeId(url)

  if (ytId && !playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="relative block w-full max-w-full my-3 rounded-md overflow-hidden border border-border group"
        aria-label={alt ? `Play video: ${alt}` : "Play video"}
      >
        <img
          src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
          alt={alt ?? "video thumbnail"}
          className="w-full h-auto block"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
          <span className="text-4xl">▶️</span>
        </span>
      </button>
    )
  }

  return (
    <iframe
      src={url}
      title={alt || "Embedded video"}
      className="w-full aspect-video max-w-full my-3 rounded-md border border-border"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      allowFullScreen
    />
  )
}

/**
 * If `url` points at a video (direct mp4/webm/ogg file, or an allowlisted embed
 * host), return the video element; otherwise null. Shared by the image and link
 * renderers so a video renders whether the model wrote `![alt](url)` or the plain
 * link form `[alt](url)`.
 */
function videoElementFor(url: string, label?: string): ReactElement | null {
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) {
    return (
      <video
        src={url}
        controls
        className="max-w-full h-auto rounded-md border border-border my-3"
        onError={(e) => {
          const el = e.currentTarget
          const link = document.createElement("a")
          link.href = url
          link.target = "_blank"
          link.rel = "noopener noreferrer"
          link.textContent = label ? `▶ ${label}` : "▶ Open video"
          link.className =
            "text-accent hover:text-accent-bright underline text-sm"
          el.replaceWith(link)
        }}
      />
    )
  }
  if (VIDEO_EMBED_HOSTS.test(hostOf(url))) {
    return <VideoEmbed url={url} alt={label} />
  }
  return null
}

const markdownComponents: Components = {
  h1: ({ children, ...props }: ComponentPropsWithoutRef<"h1">) => (
    <h1
      className="text-xl font-semibold text-text mt-6 mb-3 pb-2 border-b border-border"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: ComponentPropsWithoutRef<"h2">) => (
    <h2
      className="text-lg font-semibold text-text mt-5 mb-2 pb-1.5 border-b border-border/50"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="text-base font-semibold text-text mt-4 mb-2" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: ComponentPropsWithoutRef<"h4">) => (
    <h4 className="text-sm font-semibold text-text mt-3 mb-1.5" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: ComponentPropsWithoutRef<"h5">) => (
    <h5 className="text-xs font-semibold text-text-muted mt-3 mb-1" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: ComponentPropsWithoutRef<"h6">) => (
    <h6 className="text-xs font-semibold text-text-dim mt-2 mb-1" {...props}>
      {children}
    </h6>
  ),

  p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => (
    <p className="text-sm text-text-muted leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),

  a: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => {
    // The model sometimes writes a video as a plain link `[title](url)` instead
    // of the image marker — embed it as a player rather than a bare link.
    const url = typeof href === "string" ? href : ""
    const label = typeof children === "string" ? children : undefined
    const asVideo = videoElementFor(url, label)
    if (asVideo) return asVideo
    return (
      <a
        href={href}
        className="text-accent hover:text-accent-bright underline underline-offset-2 transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    )
  },

  strong: ({ children, ...props }: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-text" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }: ComponentPropsWithoutRef<"em">) => (
    <em className="italic text-text-muted" {...props}>
      {children}
    </em>
  ),
  del: ({ children, ...props }: ComponentPropsWithoutRef<"del">) => (
    <del className="line-through text-text-dim" {...props}>
      {children}
    </del>
  ),

  blockquote: ({
    children,
    ...props
  }: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="border-l-2 border-accent/40 pl-4 my-3 text-text-muted italic"
      {...props}
    >
      {children}
    </blockquote>
  ),

  ul: ({ children, ...props }: ComponentPropsWithoutRef<"ul">) => (
    <ul className="list-disc list-outside pl-5 mb-3 space-y-1" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: ComponentPropsWithoutRef<"ol">) => (
    <ol className="list-decimal list-outside pl-5 mb-3 space-y-1" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: ComponentPropsWithoutRef<"li">) => (
    <li className="text-sm text-text-muted leading-relaxed" {...props}>
      {children}
    </li>
  ),

  hr: (props: ComponentPropsWithoutRef<"hr">) => (
    <hr className="border-border my-6" {...props} />
  ),

  img: ({ alt, src, ...props }: ComponentPropsWithoutRef<"img">) => {
    // A media marker resolves to a URL whose kind we detect: video embed / mp4 →
    // player; otherwise an ordinary image.
    const url = typeof src === "string" ? src : ""
    const asVideo = videoElementFor(url, alt)
    if (asVideo) return asVideo
    return (
      <img
        alt={alt}
        src={src}
        className="max-w-full h-auto rounded-md border border-border my-3"
        onError={(e) => {
          // Graceful degrade: a dead source URL shows alt text instead of a
          // broken-image icon (handles URL rot in stored conversations).
          const el = e.currentTarget
          el.style.display = "none"
          const note = document.createElement("span")
          note.textContent = alt ? `🖼️ ${alt}` : "🖼️ image unavailable"
          note.className = "text-xs text-text-dim italic"
          el.replaceWith(note)
        }}
        {...props}
      />
    )
  },

  table: ({ children, ...props }: ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto my-3">
      <table
        className="w-full text-sm border-collapse border border-border"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-bg-elevated" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: ComponentPropsWithoutRef<"tbody">) => (
    <tbody {...props}>{children}</tbody>
  ),
  tr: ({ children, ...props }: ComponentPropsWithoutRef<"tr">) => (
    <tr className="border-b border-border" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
    <th
      className="text-left text-xs font-semibold text-text px-3 py-2 border border-border"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
    <td
      className="text-xs text-text-muted px-3 py-2 border border-border"
      {...props}
    >
      {children}
    </td>
  ),

  pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => (
    <pre
      className="bg-bg-surface rounded-md p-4 my-3 overflow-x-auto text-xs leading-relaxed"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({
    children,
    className,
    ...props
  }: ComponentPropsWithoutRef<"code">) => {
    // Fenced code blocks get a className like "language-js" from react-markdown.
    // Inline code does not receive a className.
    const isBlock =
      typeof className === "string" && className.startsWith("language-")

    if (isBlock) {
      return (
        <code
          className={`font-mono text-text-muted ${className ?? ""}`}
          {...props}
        >
          {children}
        </code>
      )
    }

    return (
      <code
        className="font-mono text-xs bg-bg-surface text-accent-bright px-1.5 py-0.5 rounded"
        {...props}
      >
        {children}
      </code>
    )
  },

  input: ({ type, checked, ...props }: ComponentPropsWithoutRef<"input">) => {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 accent-accent"
          {...props}
        />
      )
    }
    return <input type={type} {...props} />
  }
}

function TogglePill({
  mode,
  onToggle
}: {
  mode: Mode
  onToggle: (next: Mode) => void
}) {
  return (
    <div className="inline-flex items-center bg-elevated border border-border rounded-full text-[10px] overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle("raw")}
        className={`px-2 py-0.5 transition-colors ${
          mode === "raw"
            ? "bg-accent/20 text-accent"
            : "text-text-muted hover:text-text"
        }`}
      >
        Raw
      </button>
      <button
        type="button"
        onClick={() => onToggle("rendered")}
        className={`px-2 py-0.5 transition-colors ${
          mode === "rendered"
            ? "bg-accent/20 text-accent"
            : "text-text-muted hover:text-text"
        }`}
      >
        Rendered
      </button>
    </div>
  )
}

export function MarkdownViewer({
  content,
  className,
  showToggle = true,
  defaultMode = "rendered"
}: MarkdownViewerProps) {
  const [mode, setMode] = useState<Mode>(defaultMode)

  return (
    <div className={`relative ${className ?? ""}`}>
      {showToggle && (
        <div className="absolute top-2 right-2 z-10">
          <TogglePill mode={mode} onToggle={setMode} />
        </div>
      )}

      {mode === "raw" ? (
        <pre className="whitespace-pre-wrap font-mono text-xs text-text-muted p-4 overflow-auto">
          {content}
        </pre>
      ) : (
        <div className="p-4 pr-24">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
            components={markdownComponents}
          >
            {prepareRendered(content)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}
