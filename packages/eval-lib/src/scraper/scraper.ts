import { htmlToMarkdown } from "../file-processing/html-to-markdown.js"
import type { ScrapedPage, ScrapeOptions } from "./types.js"
import { assertPublicHttpUrl } from "./url-guard.js"

export interface ContentScraperConfig {
  userAgent?: string
  defaultHeaders?: Record<string, string>
}

export class ContentScraper {
  private userAgent: string
  private defaultHeaders: Record<string, string>

  constructor(config?: ContentScraperConfig) {
    this.userAgent =
      config?.userAgent ?? "Mozilla/5.0 (compatible; RAGEvalBot/1.0)"
    this.defaultHeaders = config?.defaultHeaders ?? {}
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage> {
    const MAX_BYTES = 10 * 1024 * 1024 // 10 MB cap
    const MAX_REDIRECTS = 5
    const controller = new AbortController()
    const timeoutMs = options?.timeout ?? 30_000
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      let current = assertPublicHttpUrl(url).toString()
      let response: Response | undefined

      // Manual redirect loop so each hop's host is re-validated (SSRF defense).
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        response = await fetch(current, {
          headers: {
            "User-Agent": this.userAgent,
            ...this.defaultHeaders,
            ...options?.headers
          },
          redirect: "manual",
          signal: controller.signal
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location")
          if (!location) break
          current = assertPublicHttpUrl(
            new URL(location, current).toString()
          ).toString()
          if (hop === MAX_REDIRECTS) throw new Error("Too many redirects")
          continue
        }
        break
      }
      if (!response) throw new Error("No response")

      const contentType = response.headers.get("content-type") ?? ""
      if (
        contentType &&
        !/text\/html|text\/plain|application\/xhtml/i.test(contentType)
      ) {
        throw new Error(`Unsupported content-type: ${contentType}`)
      }
      const declaredLength = Number(
        response.headers.get("content-length") ?? "0"
      )
      if (declaredLength > MAX_BYTES) {
        throw new Error(`Response too large: ${declaredLength} bytes`)
      }

      const html = await response.text()
      if (html.length > MAX_BYTES) {
        throw new Error(`Response too large: ${html.length} bytes`)
      }

      const result = await htmlToMarkdown(html, {
        onlyMainContent: options?.onlyMainContent ?? true,
        baseUrl: current
      })

      const descMatch = html.match(
        /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
      )
      const langMatch = html.match(/<html[^>]*lang=["']([^"']*)["']/i)

      return {
        url,
        markdown: result.content,
        metadata: {
          title: result.title,
          sourceURL: url,
          description: descMatch?.[1],
          language: langMatch?.[1],
          statusCode: response.status,
          links: result.links
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
