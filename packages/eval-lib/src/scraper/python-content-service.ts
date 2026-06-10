import type {
  NormalizedCallback,
  ParseOptions,
  Parser,
  Scraper,
  ScraperCrawlConfig
} from "./ports.js"

export interface PythonContentServiceConfig {
  baseUrl: string
  apiToken: string
  hmacSecret: string
  /** Per-request timeout for outbound calls to Tarser. Defaults to 30s. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

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
        `Tarser cancel failed: HTTP ${res.status} ${await res.text()}`
      )
    }
  }

  private async parseJobAccepted(
    res: {
      status: number
      json: () => Promise<unknown>
      text: () => Promise<string>
    },
    op: string
  ): Promise<{ serviceJobId: string }> {
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Tarser ${op} failed: HTTP ${res.status} ${await res.text()}`
      )
    }
    // Read text first, then parse: a proxy/gateway can return an empty or
    // non-JSON 2xx, and res.json() would throw a confusing parse error that
    // hides the real response.
    const text = await res.text()
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
          finishReason: String(raw.finish_reason ?? "unknown"),
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
        finishReason: String(raw.finish_reason ?? "unknown"),
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
