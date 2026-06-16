import { MAX_CONTENT_RESPONSE_BYTES, readCappedText } from "./http.js"
import type {
  ParsedFile,
  ParseOptions,
  Parser,
  ParserJobResult,
  ScrapedPage,
  ScrapeOptions,
  Scraper,
  ScraperCrawlConfig,
  ScraperJobResult
} from "./ports.js"
import { JobNotReadyError, NotSupportedError } from "./ports.js"
import { FinishReason } from "./wire.js"

export interface AsimovContentServiceConfig {
  baseUrl: string
  apiToken: string
  /** Per-request timeout for outbound calls to Asimov. Defaults to 30s. */
  timeoutMs?: number
  /** How long getResult() polls the status endpoint before giving up. Defaults to 9 min. */
  pollDeadlineMs?: number
  /** Delay between status polls inside getResult(). Defaults to 5s. */
  pollIntervalMs?: number
  /** Page size for the paginated content drain. Defaults to 200. */
  contentPageLimit?: number
  /**
   * Startup grace window during which a `not_found` status is treated as
   * in-progress rather than terminal. Asimov returns NOT_FOUND in the brief
   * window after POST returns the id but before the worker registers the job,
   * so a healthy job can otherwise be declared failed on the first poll.
   * Defaults to 30s.
   */
  notFoundGraceMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_POLL_DEADLINE_MS = 9 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_CONTENT_PAGE_LIMIT = 200
const DEFAULT_NOT_FOUND_GRACE_MS = 30_000
// Backstop so a server that keeps emitting a fresh next_cursor can't drain forever.
const MAX_DRAIN_ITERATIONS = 100_000

// Asimov finish_reason values that mean the crawl completed as requested (ran out
// of links or hit its configured page cap). The host's normal-finish check only
// knows the tarser vocabulary, so map these onto FinishReason.Finished rather than
// letting a successful crawl be flagged completed_with_errors.
const NORMAL_ASIMOV_FINISH = new Set([
  "",
  "unknown",
  "finished",
  "completed",
  "closespider_pagecount",
  "closespider_itemcount"
])

// Loader ids understood by Asimov's POST /api/data-resources. Crawl uses the
// web loader; parse uses the PDF loader.
const WEB_LOADER = "web_base_loader"
const PDF_LOADER = "pdf_loader"

// Terminal status strings Asimov reports for a data resource. Asimov emits an
// UPPERCASE enum: PENDING | RUNNING | SUCCESS | FAILURE | NOT_FOUND. The status
// drives when getResult() stops polling and drains content. Compared
// case-insensitively (the caller lowercases before checking these sets).
const SUCCESS_STATUSES = new Set(["success"])
const FAILURE_STATUSES = new Set(["failure", "not_found"])

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

type AsimovContentPage = {
  url?: unknown
  markdown?: unknown
  metadata?: unknown
}

// Asimov reports `failed` as a list[str] of URL strings. Older/alternate shapes
// may carry an object — accept both.
type AsimovFailedItem =
  | string
  | {
      url?: unknown
      error?: unknown
    }

type AsimovContentResponse = {
  status?: unknown
  finish_reason?: unknown
  next_cursor?: unknown
  pages?: unknown
  files?: unknown
  failed?: unknown
}

/**
 * Remote crawler + parser backed by the Asimov content service. Implements BOTH
 * ports. Unlike the Tarser client, Asimov is POLL-based: startCrawl/startParse
 * SUBMIT ONLY, and getResult() polls the status endpoint to completion then drains
 * the paginated content endpoint and normalizes it into ScrapedPage[] / ParsedFile.
 * No HMAC, no callbacks — the callbackUrl arg is accepted for port parity and ignored.
 * Pure and Convex-agnostic; the Convex side owns the re-poll cadence via the scheduler.
 */
export class AsimovContentService implements Scraper, Parser {
  readonly name = "asimov"
  constructor(private readonly config: AsimovContentServiceConfig) {}

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      "Content-Type": "application/json"
    }
  }

  /** AbortSignal that fires after the configured timeout, so a hung Asimov
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

  async parseFile(_bytes: Uint8Array, _mimeType: string): Promise<ParsedFile> {
    throw new NotSupportedError("parseFile", this.name)
  }

  async startCrawl(args: {
    startUrl: string
    config: ScraperCrawlConfig
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    // content_only rides inside loader_options → no schema break on Asimov's side.
    return this.submit(
      {
        loader: WEB_LOADER,
        loader_options: {
          url: args.startUrl,
          content_only: true,
          ...crawlConfigToLoaderOptions(args.config)
        }
      },
      "startCrawl"
    )
  }

  async startParse(args: {
    fileUrl: string
    mimeType: string
    options?: ParseOptions
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    const opts = args.options ?? {}
    return this.submit(
      {
        loader: PDF_LOADER,
        loader_options: {
          url: args.fileUrl,
          content_only: true,
          // Only forward OCR-related flags when set, so Asimov applies its own
          // defaults otherwise (mirrors the Tarser parse path).
          ...(opts.ocr === undefined ? {} : { ocr: opts.ocr }),
          ...(opts.captionImages === undefined
            ? {}
            : { captionImages: opts.captionImages }),
          ...(opts.ocrProvider === undefined
            ? {}
            : { ocrProvider: opts.ocrProvider })
        }
      },
      "startParse"
    )
  }

  async cancel(serviceJobId: string): Promise<void> {
    // Asimov maps cancellation to deleting the data resource. Its only DELETE
    // route is the collection endpoint taking { data_resource_ids: [...] } as a
    // JSON body — there is no per-id DELETE path.
    const res = await fetch(`${this.config.baseUrl}/api/data-resources`, {
      method: "DELETE",
      headers: this.authHeaders,
      signal: this.timeoutSignal(),
      body: JSON.stringify({ data_resource_ids: [serviceJobId] })
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Asimov cancel failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
  }

  /**
   * Poll the data resource to completion, then drain the paginated content and
   * normalize it. The Convex side re-invokes the whole submit→getResult flow via
   * the scheduler; this method also polls internally up to pollDeadlineMs so a
   * single call resolves a job that finishes within one action budget.
   */
  async getResult(
    serviceJobId: string,
    expectedKind?: "crawl" | "parse"
  ): Promise<ScraperJobResult | ParserJobResult> {
    // Block until terminal, then drain. A failed resource still carries a content
    // envelope (finish_reason + failures), and drainContent reports the failure.
    // pollUntilDone returns the AUTHORITATIVE terminal status from /status; thread
    // it into the drain so a failure can't be masked by a /content envelope that
    // omits `status`.
    const terminalStatus = await this.pollUntilDone(serviceJobId)
    return this.drainContent(serviceJobId, expectedKind, terminalStatus)
  }

  /** Poll GET /api/data-resources/{id}/status until terminal or the deadline. */
  private async pollUntilDone(serviceJobId: string): Promise<string> {
    const start = Date.now()
    const deadline =
      start + (this.config.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS)
    const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    // `not_found` is terminal in general, but Asimov also reports it in the
    // brief window between POST returning the id and the worker registering the
    // job. Treat it as in-progress until this grace deadline elapses.
    const notFoundGraceDeadline =
      start + (this.config.notFoundGraceMs ?? DEFAULT_NOT_FOUND_GRACE_MS)
    // First read happens immediately; subsequent reads wait `interval`.
    for (;;) {
      const status = await this.fetchStatus(serviceJobId)
      const lower = status.toLowerCase()
      // Within the startup grace window, a not-yet-registered job (not_found) is
      // still pending — keep polling rather than declaring an early failure.
      const notFoundPending =
        lower === "not_found" && Date.now() < notFoundGraceDeadline
      if (
        !notFoundPending &&
        (SUCCESS_STATUSES.has(lower) || FAILURE_STATUSES.has(lower))
      ) {
        return status
      }
      if (Date.now() + interval >= deadline) {
        // Not terminal before the deadline: signal the host to re-poll later.
        throw new JobNotReadyError(serviceJobId, status)
      }
      await sleep(interval)
    }
  }

  private async fetchStatus(serviceJobId: string): Promise<string> {
    const res = await fetch(
      `${this.config.baseUrl}/api/data-resources/${encodeURIComponent(serviceJobId)}/status`,
      { headers: this.authHeaders, signal: this.timeoutSignal() }
    )
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Asimov status failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
    const text = await readCappedText(res)
    let body: { status?: unknown }
    try {
      body = JSON.parse(text) as { status?: unknown }
    } catch {
      throw new Error(
        `Asimov status: expected JSON, got HTTP ${res.status} body: ${text.slice(0, 200)}`
      )
    }
    if (typeof body.status !== "string" || body.status.length === 0) {
      throw new Error("Asimov status: missing status in response")
    }
    return body.status
  }

  /**
   * Drain GET /content/{id}?cursor=&limit=, following next_cursor until exhausted,
   * and normalize into a crawl or parse result.
   *
   * The cross-repo seam: for a PDF parse Asimov stashes the parsed markdown into
   * the `pages` list (with content_type "application/pdf"), and the content
   * envelope's `files` is the discovered-file-URL set from crawls — a different
   * concept. So `pages` is non-empty for BOTH parse and crawl and a shape
   * heuristic mislabels parses. The caller knows the kind, so it passes
   * `expectedKind`; we honor that. We keep the raw page objects alongside the
   * normalized ScrapedPage[] so a parse can be built from page markdown.
   */
  private async drainContent(
    serviceJobId: string,
    expectedKind?: "crawl" | "parse",
    knownStatus?: string
  ): Promise<ScraperJobResult | ParserJobResult> {
    const limit = this.config.contentPageLimit ?? DEFAULT_CONTENT_PAGE_LIMIT
    const pages: ScrapedPage[] = []
    const rawPages: AsimovContentPage[] = []
    const failed: { url: string; error?: string }[] = []
    let finishReason: string = FinishReason.Unknown
    // The polled /status is authoritative; only fall back to the /content
    // envelope's status when the caller didn't supply one.
    let terminalStatus = knownStatus ?? ""
    let cursor: string | undefined
    let iterations = 0

    for (;;) {
      if (++iterations > MAX_DRAIN_ITERATIONS) {
        throw new Error(
          `Asimov content drain exceeded ${MAX_DRAIN_ITERATIONS} pages for ${serviceJobId}`
        )
      }
      const body = await this.fetchContentPage(serviceJobId, cursor, limit)
      if (knownStatus === undefined && typeof body.status === "string") {
        terminalStatus = body.status
      }
      if (typeof body.finish_reason === "string") {
        finishReason = body.finish_reason
      }
      if (Array.isArray(body.pages)) {
        for (const raw of body.pages as AsimovContentPage[]) {
          rawPages.push(raw)
          const page = normalizeScrapedPage(raw)
          if (page) pages.push(page)
        }
      }
      // Asimov returns `files` as a list[str] of discovered-file URLs. The
      // normalized crawl/parse result never surfaces them, so we don't collect
      // them — the field stays declared on AsimovContentResponse for honesty.
      if (Array.isArray(body.failed)) {
        for (const raw of body.failed as AsimovFailedItem[]) {
          failed.push(normalizeFailed(raw))
        }
      }
      // Asimov sends next_cursor as an integer offset (or null/absent when the
      // content is exhausted). Follow it while present; a string cursor is also
      // tolerated. Coerce to string for the next request's query parameter.
      const next = body.next_cursor
      if (next == null) break
      if (typeof next === "string" && next.length === 0) break
      const nextCursor = String(next)
      // Stop if the cursor did not advance — a server that re-emits the same
      // offset (e.g. 0) must not be re-fetched forever.
      if (nextCursor === cursor) break
      cursor = nextCursor
    }

    // A successful crawl that ran out of links or hit its page cap is a normal
    // finish; map it onto the host's normal vocabulary. Failed crawls keep their
    // raw reason so the host can still flag them.
    const crawlFinish = SUCCESS_STATUSES.has(terminalStatus.toLowerCase())
      ? normalizeCrawlFinishReason(finishReason)
      : finishReason

    // Honor the caller's explicit hint when present (it knows what it submitted).
    if (expectedKind === "parse") {
      // The parsed document arrives in `pages`. Concatenate page markdown in
      // order into a single document (handles multi-page / multi-file parses).
      return normalizeParseResult(rawPages, failed, terminalStatus)
    }
    if (expectedKind === "crawl") {
      return { kind: "crawl", finishReason: crawlFinish, pages, failed }
    }

    // No hint: default to a crawl result. `files` carries only discovered-file
    // URL strings (never document markdown), so it can't stand in for a parse.
    return {
      kind: "crawl",
      finishReason: crawlFinish,
      pages,
      failed
    }
  }

  private async fetchContentPage(
    serviceJobId: string,
    cursor: string | undefined,
    limit: number
  ): Promise<AsimovContentResponse> {
    const url = new URL(`${this.config.baseUrl}/content/${serviceJobId}`)
    if (cursor !== undefined) url.searchParams.set("cursor", cursor)
    url.searchParams.set("limit", String(limit))
    const res = await fetch(url.toString(), {
      headers: this.authHeaders,
      signal: this.timeoutSignal()
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Asimov content failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
    // Content must parse whole; fail loudly on an oversized page rather than
    // truncating mid-JSON into a misleading "expected JSON" error.
    const text = await readCappedText(res, MAX_CONTENT_RESPONSE_BYTES, {
      throwOnTruncate: true
    })
    try {
      return JSON.parse(text) as AsimovContentResponse
    } catch {
      throw new Error(
        `Asimov content: expected JSON, got HTTP ${res.status} body: ${text.slice(0, 200)}`
      )
    }
  }

  private async submit(
    body: { loader: string; loader_options: Record<string, unknown> },
    op: string
  ): Promise<{ serviceJobId: string }> {
    const res = await fetch(`${this.config.baseUrl}/api/data-resources`, {
      method: "POST",
      headers: this.authHeaders,
      signal: this.timeoutSignal(),
      body: JSON.stringify(body)
    })
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Asimov ${op} failed: HTTP ${res.status} ${await readCappedText(res)}`
      )
    }
    // Read text first, then parse: a proxy/gateway can return an empty or
    // non-JSON 2xx, and res.json() would throw a confusing parse error that
    // hides the real response.
    const text = await readCappedText(res)
    let parsed: { data_resource_id?: unknown }
    try {
      parsed = JSON.parse(text) as { data_resource_id?: unknown }
    } catch {
      throw new Error(
        `Asimov ${op}: expected JSON, got HTTP ${res.status} body: ${text.slice(0, 200)}`
      )
    }
    const id = parsed.data_resource_id
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Asimov ${op}: missing data_resource_id in response`)
    }
    return { serviceJobId: id }
  }
}

/** Map the eval-lib crawl config to Asimov web-loader options (best-effort). */
function crawlConfigToLoaderOptions(
  config: ScraperCrawlConfig
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.maxPages !== undefined) out.max_pages = config.maxPages
  if (config.maxDepth !== undefined) out.max_depth = config.maxDepth
  // Browser mode routes the crawl onto Asimov's Playwright/Chromium queue. Only
  // opt in for an explicit "browser" mode; "http"/undefined leave the default.
  if (config.crawlMode === "browser") out.use_browser = true
  if (config.preferSitemap !== undefined) {
    out.prefer_sitemap = config.preferSitemap
  }
  return out
}

/** Map an Asimov crawl finish_reason onto the host's normal-finish vocabulary. */
function normalizeCrawlFinishReason(raw: string): string {
  return NORMAL_ASIMOV_FINISH.has(raw.toLowerCase())
    ? FinishReason.Finished
    : raw
}

/** Normalize one Asimov content page into a ScrapedPage, or null if unusable. */
function normalizeScrapedPage(raw: AsimovContentPage): ScrapedPage | null {
  const url = typeof raw.url === "string" ? raw.url : ""
  if (url.length === 0) return null
  const markdown = typeof raw.markdown === "string" ? raw.markdown : ""
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>
  const title =
    typeof metadata.title === "string" && metadata.title.length > 0
      ? metadata.title
      : url
  const description =
    typeof metadata.description === "string" ? metadata.description : undefined
  const language =
    typeof metadata.language === "string" ? metadata.language : undefined
  const statusCode =
    typeof metadata.statusCode === "number" ? metadata.statusCode : 200
  const links = Array.isArray(metadata.links)
    ? (metadata.links as unknown[]).filter(
        (l): l is string => typeof l === "string"
      )
    : []
  return {
    url,
    markdown,
    metadata: {
      title,
      sourceURL: url,
      description,
      language,
      statusCode,
      links
    }
  }
}

/** Normalize an Asimov `failed` entry. Asimov emits bare URL strings; an object
 * `{url,error}` is also accepted for forward/backward compatibility. */
function normalizeFailed(raw: AsimovFailedItem): {
  url: string
  error?: string
} {
  if (typeof raw === "string") {
    return { url: raw }
  }
  return {
    url: typeof raw.url === "string" ? raw.url : "",
    error: typeof raw.error === "string" ? raw.error : undefined
  }
}

/**
 * Build a single parse result from the drained document entries of a parse job.
 * Asimov returns the parsed doc as one-or-more entries (pages for `pdf_loader`,
 * each carrying `markdown`); concatenate their markdown in order into one
 * document so multi-page / multi-file parses collapse to a single ParsedFile.
 */
function normalizeParseResult(
  entries: AsimovContentPage[],
  failed: { url: string; error?: string }[],
  terminalStatus: string
): ParserJobResult {
  const markdown = entries
    .map((e) => (typeof e.markdown === "string" ? e.markdown : ""))
    .filter((m) => m.length > 0)
    .join("\n\n")
  const first = entries[0]
  const metadata =
    first && first.metadata != null
      ? (first.metadata as Record<string, unknown>)
      : undefined
  const title =
    metadata && typeof metadata.title === "string" ? metadata.title : undefined
  const ok =
    markdown.trim().length > 0 &&
    !FAILURE_STATUSES.has(terminalStatus.toLowerCase())
  if (!ok) {
    return {
      kind: "parse",
      status: "failed",
      error: failed[0]?.error ?? "Asimov returned no content"
    }
  }
  return {
    kind: "parse",
    status: "ok",
    file: { markdown, title, metadata }
  }
}
