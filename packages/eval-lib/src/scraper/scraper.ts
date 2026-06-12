import { lookup } from "node:dns/promises"
import { htmlToMarkdown } from "../file-processing/html-to-markdown.js"
import type { ScrapedPage, ScrapeOptions } from "./types.js"
import { assertPublicHttpUrl, isBlockedHost } from "./url-guard.js"

/** Resolve a hostname to its IP address strings. Injectable for tests. */
export type DnsLookup = (host: string) => Promise<string[]>

const defaultDnsLookup: DnsLookup = async (host) => {
  const records = await lookup(host, { all: true })
  return records.map((r) => r.address)
}

/**
 * Resolve `host` and reject if any resolved address is a private/loopback/metadata IP.
 * Blocks DNS names that point into internal space (the gap the string-only
 * `assertPublicHttpUrl` can't see). Standalone so non-scraper callers (e.g. the
 * Tarser submit path) run the same DNS-aware SSRF check the in-process crawler
 * uses. A fetch-based client still re-resolves DNS itself, so a narrow TOCTOU
 * window remains; fully closing it requires IP pinning via a custom dispatcher.
 */
export async function assertHostResolvesPublic(
  host: string,
  dnsLookup: DnsLookup = defaultDnsLookup
): Promise<void> {
  let addresses: string[]
  try {
    addresses = await dnsLookup(host)
  } catch {
    throw new Error(`DNS resolution failed for host: ${host}`)
  }
  for (const addr of addresses) {
    if (isBlockedHost(addr)) {
      throw new Error(
        `Blocked host resolves to private/loopback/metadata IP: ${host} -> ${addr}`
      )
    }
  }
}

export interface ContentScraperConfig {
  userAgent?: string
  defaultHeaders?: Record<string, string>
  /**
   * Resolver used to re-check each hop's host against the SSRF denylist after DNS
   * resolution. Defaults to node:dns. Override in tests to avoid real network lookups.
   */
  dnsLookup?: DnsLookup
}

export class ContentScraper {
  private userAgent: string
  private defaultHeaders: Record<string, string>
  private dnsLookup: DnsLookup

  constructor(config?: ContentScraperConfig) {
    this.userAgent =
      config?.userAgent ?? "Mozilla/5.0 (compatible; RAGEvalBot/1.0)"
    this.defaultHeaders = config?.defaultHeaders ?? {}
    this.dnsLookup = config?.dnsLookup ?? defaultDnsLookup
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
        // Re-resolve and re-check the host's IPs before every fetch (DNS rebinding).
        await assertHostResolvesPublic(
          new URL(current).hostname,
          this.dnsLookup
        )
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

      // Treat any non-2xx final response as a failure so it reaches markUrlFailed
      // instead of being parsed and stored as KB content.
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Request failed with status ${response.status}`)
      }

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

      const html = await readBodyWithCap(response, MAX_BYTES, charsetFromContentType(contentType))

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

function charsetFromContentType(contentType: string): string {
  const m = contentType.match(/charset=([\w-]+)/i)
  return m?.[1] ?? "utf-8"
}

/**
 * Read a response body as text, aborting once accumulated bytes exceed `maxBytes`.
 * Streams chunk-by-chunk so a server that omits or lies about Content-Length, or
 * streams forever, cannot exhaust memory. Falls back to response.text() only when no
 * readable body stream is available (e.g. test mocks).
 */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
  charset = "utf-8"
): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    const byteLength = Buffer.byteLength(text, "utf8")
    if (byteLength > maxBytes) {
      throw new Error(`Response too large: ${byteLength} bytes`)
    }
    return text
  }

  const reader = response.body.getReader()
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset)
  } catch {
    decoder = new TextDecoder()
  }
  let received = 0
  let result = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        throw new Error(`Response too large: exceeded ${maxBytes} bytes`)
      }
      result += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  result += decoder.decode()
  return result
}
