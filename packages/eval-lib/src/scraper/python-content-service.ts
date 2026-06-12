import type {
  NormalizedCallback,
  ParsedFile,
  ParseOptions,
  Parser,
  ScrapedPage,
  ScrapeOptions,
  Scraper,
  ScraperCrawlConfig
} from "./ports.js"
import { NotSupportedError } from "./ports.js"
import { FinishReason } from "./wire.js"

export interface PythonContentServiceConfig {
  baseUrl: string
  apiToken: string
  hmacSecret: string
  /** Per-request timeout for outbound calls to Tarser. Defaults to 30s. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

// Control-plane responses (job-accepted envelopes, error bodies) are tiny.
// Cap the read so a large or hostile Tarser/proxy response cannot be buffered
// unbounded into the action before JSON.parse / error formatting.
const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024

/**
 * Read a response body as text, decoding at most ~maxBytes. Streams
 * chunk-by-chunk and slices each chunk to the remaining budget before decoding,
 * so a server that omits or lies about Content-Length never has more than
 * maxBytes decoded into memory here. Truncates rather than throwing, so the
 * bounded text is usable for both JSON parsing and error diagnostics. Falls back
 * to response.text() when no readable body stream is available (test mocks).
 */
async function readCappedText(
  res: Response,
  maxBytes = MAX_CONTROL_RESPONSE_BYTES
): Promise<string> {
  if (!res.body) {
    const text = await res.text()
    return Buffer.byteLength(text, "utf8") > maxBytes
      ? Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")
      : text
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let result = ""
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - received
      const slice =
        value.byteLength > remaining ? value.subarray(0, remaining) : value
      received += slice.byteLength
      result += decoder.decode(slice, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  result += decoder.decode()
  return result
}

/**
 * Remote crawler + parser backed by the Tarser HTTP service. Implements BOTH ports.
 * Submit/cancel/health go over HTTP here; results arrive later as HMAC-signed callbacks
 * the HOST receives (see backend http.ts). normalizeCallback() maps Tarser's snake_case
 * events into the eval-lib NormalizedCallback union.
 */
export class PythonContentService implements Scraper, Parser {
  readonly name = "tarser"
  constructor(private readonly config: PythonContentServiceConfig) {}

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      "Content-Type": "application/json"
    }
  }

  /** AbortSignal that fires after the configured timeout, so a hung Tarser
   * instance cannot stall the action until the Convex ~10-min kill. */
  private timeoutSignal(): AbortSignal {
    return AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/healthz`, {
        signal: this.timeoutSignal()
      })
      return res.status === 200
    } catch {
      return false
    }
  }

  async scrapePage(
    _url: string,
    _options?: ScrapeOptions
  ): Promise<ScrapedPage> {
    throw new NotSupportedError("scrapePage", this.name)
  }

  async startCrawl(args: {
    startUrl: string
    config: ScraperCrawlConfig
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    const res = await fetch(`${this.config.baseUrl}/jobs`, {
      method: "POST",
      headers: this.authHeaders,
      signal: this.timeoutSignal(),
      body: JSON.stringify({
        type: "crawl",
        startUrl: args.startUrl,
        config: args.config,
        callbackUrl: args.callbackUrl
      })
    })
    return this.parseJobAccepted(res, "startCrawl")
  }

  async parseFile(_bytes: Uint8Array, _mimeType: string): Promise<ParsedFile> {
    throw new NotSupportedError("parseFile", this.name)
  }

  async startParse(args: {
    fileUrl: string
    mimeType: string
    options?: ParseOptions
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    const res = await fetch(`${this.config.baseUrl}/parse`, {
      method: "POST",
      headers: this.authHeaders,
      signal: this.timeoutSignal(),
      body: JSON.stringify({
        fileUrl: args.fileUrl,
        mimeType: args.mimeType,
        options: args.options ?? {},
        callbackUrl: args.callbackUrl
      })
    })
    return this.parseJobAccepted(res, "startParse")
  }

  async cancel(serviceJobId: string): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/jobs/${encodeURIComponent(serviceJobId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        signal: this.timeoutSignal()
      }
    )
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Tarser cancel failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
  }

  private async parseJobAccepted(
    res: Response,
    op: string
  ): Promise<{ serviceJobId: string }> {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Tarser ${op} failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
    // Read text first, then parse: a proxy/gateway can return an empty or
    // non-JSON 2xx, and res.json() would throw a confusing parse error that
    // hides the real response.
    const text = await readCappedText(res)
    let body: { serviceJobId?: string }
    try {
      body = JSON.parse(text) as { serviceJobId?: string }
    } catch {
      throw new Error(
        `Tarser ${op}: expected JSON, got HTTP ${res.status} body: ${text.slice(0, 200)}`
      )
    }
    if (!body.serviceJobId) {
      throw new Error(`Tarser ${op}: missing serviceJobId in response`)
    }
    return { serviceJobId: body.serviceJobId }
  }

  /** Map a raw Tarser callback body (snake_case) into the normalized union. */
  static normalizeCallback(raw: Record<string, unknown>): NormalizedCallback {
    const event = String(raw.event ?? "")
    const serviceJobId = String(raw.service_job_id ?? "")
    if (!serviceJobId) return { kind: "ignored", event }

    if (event === "url_done") {
      const status = String(raw.status ?? "")
      const url = String(raw.url ?? "")
      const metadata = (raw.metadata ?? {}) as Record<string, unknown>
      if (status === "failed") {
        return {
          kind: "page_failed",
          serviceJobId,
          url,
          error: raw.error == null ? undefined : String(raw.error),
          finishReason: String(raw.finish_reason ?? FinishReason.Unknown),
          errorCategory:
            raw.error_category == null ? undefined : String(raw.error_category)
        }
      }
      if (metadata.kind === "document_file") {
        return {
          kind: "discovered_file",
          serviceJobId,
          fileUrl: url,
          sourcePage:
            metadata.source_page == null
              ? undefined
              : String(metadata.source_page)
        }
      }
      return {
        kind: "page",
        serviceJobId,
        url,
        markdown: String(raw.markdown ?? ""),
        title: metadata.title == null ? undefined : String(metadata.title),
        depth: typeof metadata.depth === "number" ? metadata.depth : undefined,
        contentHash:
          raw.content_hash == null ? undefined : String(raw.content_hash)
      }
    }

    if (event === "parse_done") {
      return {
        kind: "parsed",
        serviceJobId,
        status: raw.status === "ok" ? "ok" : "failed",
        markdown: raw.markdown == null ? undefined : String(raw.markdown),
        metadata: (raw.metadata ?? undefined) as
          | Record<string, unknown>
          | undefined,
        error: raw.error == null ? undefined : String(raw.error),
        contentHash:
          raw.content_hash == null ? undefined : String(raw.content_hash)
      }
    }

    if (event === "job_complete") {
      const stats = (raw.final_stats ?? {}) as Record<string, number>
      return {
        kind: "job_complete",
        serviceJobId,
        finishReason: String(raw.finish_reason ?? FinishReason.Unknown),
        stats: {
          visited: stats.visited,
          failed: stats.failed,
          skipped: stats.skipped,
          files: stats.files
        }
      }
    }

    return { kind: "ignored", event }
  }
}
