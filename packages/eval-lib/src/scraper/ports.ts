import type { ScrapedPage, ScrapeOptions } from "./types.js"

/** Thrown by a provider method that a given backend does not support. */
export class NotSupportedError extends Error {
  constructor(method: string, backend: string) {
    super(`${method} is not supported by the "${backend}" backend`)
    this.name = "NotSupportedError"
  }
}

/**
 * Thrown by a poll-based getResult() when the job has not reached a terminal
 * status before the configured poll deadline. The host (Convex) catches this to
 * self-reschedule another poll, rather than treating it as a hard failure. Keeps
 * the "is it done yet?" decision inside eval-lib; the host owns only the cadence.
 */
export class JobNotReadyError extends Error {
  constructor(
    public readonly serviceJobId: string,
    public readonly lastStatus: string
  ) {
    super(`Job ${serviceJobId} not ready (last status: ${lastStatus})`)
    this.name = "JobNotReadyError"
  }
}

/** Crawl config sent to a remote crawler. Field names match Tarser's CrawlConfig aliases. */
export interface ScraperCrawlConfig {
  maxPages?: number
  maxDepth?: number
  includePaths?: string[]
  excludePaths?: string[]
  crawlMode?: "http" | "browser"
  allowSubdomains?: boolean
  preferSitemap?: boolean
  followFileTypes?: string[]
}

/** Parse options sent to a remote parser. Field names match Tarser's ParseOptionsModel aliases. */
export interface ParseOptions {
  parserPreference?: "pymupdf"
  ocr?: boolean
  captionImages?: boolean
  ocrProvider?: string
}

/**
 * Terminal result of a polled crawl/parse job, drained from a poll-based backend
 * (e.g. Asimov) by getResult(). Push/callback backends never produce this — they
 * deliver results out-of-band — so getResult() throws NotSupported for them.
 */
export type ScraperJobResult = {
  kind: "crawl"
  finishReason: string
  pages: ScrapedPage[]
  failed: { url: string; error?: string }[]
}

export type ParserJobResult = {
  kind: "parse"
  status: "ok" | "failed"
  file?: ParsedFile
  error?: string
}

export interface Scraper {
  readonly name: string
  checkHealth(): Promise<boolean>
  scrapePage(url: string, options?: ScrapeOptions): Promise<ScrapedPage>
  startCrawl(args: {
    startUrl: string
    config: ScraperCrawlConfig
    callbackUrl: string
  }): Promise<{ serviceJobId: string }>
  cancel(serviceJobId: string): Promise<void>
  /**
   * Poll a submitted job to completion and drain its content. Optional, present
   * only on poll-based backends (Asimov). Default/push backends throw NotSupported,
   * mirroring the InProcessScraper.startCrawl capability-optional precedent. Returns
   * a discriminated union (`kind`) because a poll backend implements BOTH ports with
   * one method; callers narrow on `kind` to the crawl or parse shape they expect.
   *
   * `expectedKind` is an optional hint from the caller (which knows whether it
   * submitted a crawl or a parse). Poll backends use it to disambiguate the
   * drained content, since a parse and a crawl can return the same `pages` shape.
   * When absent, the backend falls back to a best-effort shape heuristic.
   */
  getResult?(
    serviceJobId: string,
    expectedKind?: "crawl" | "parse"
  ): Promise<ScraperJobResult | ParserJobResult>
}

export interface Parser {
  readonly name: string
  checkHealth(): Promise<boolean>
  parseFile(bytes: Uint8Array, mimeType: string): Promise<ParsedFile>
  startParse(args: {
    fileUrl: string
    mimeType: string
    options?: ParseOptions
    callbackUrl: string
  }): Promise<{ serviceJobId: string }>
  cancel(serviceJobId: string): Promise<void>
  /** Poll-based result drain. Optional; see Scraper.getResult. */
  getResult?(
    serviceJobId: string,
    expectedKind?: "crawl" | "parse"
  ): Promise<ScraperJobResult | ParserJobResult>
}

/** A single page scraped in-process (re-exported shape for the host crawl loop). */
export type { ScrapedPage, ScrapeOptions }

/** Result of an in-process file parse. */
export interface ParsedFile {
  markdown: string
  title?: string
  metadata?: Record<string, unknown>
}

export type ScraperConfig =
  | { backend?: "inprocess"; userAgent?: string }
  | { backend: "tarser"; baseUrl: string; apiToken: string; hmacSecret: string }
  | { backend: "asimov"; baseUrl: string; apiToken: string }

export type ParserConfig =
  | { backend?: "inprocess" }
  | { backend: "tarser"; baseUrl: string; apiToken: string; hmacSecret: string }
  | { backend: "asimov"; baseUrl: string; apiToken: string }

/** Normalized form of a Tarser callback after PythonContentService.normalizeCallback(). */
export type NormalizedCallback =
  | {
      kind: "page"
      serviceJobId: string
      url: string
      markdown: string
      title?: string
      depth?: number
      contentHash?: string
    }
  | {
      kind: "page_failed"
      serviceJobId: string
      url: string
      error?: string
      finishReason: string
      errorCategory?: string
    }
  | {
      kind: "discovered_file"
      serviceJobId: string
      fileUrl: string
      sourcePage?: string
    }
  | {
      kind: "parsed"
      serviceJobId: string
      status: "ok" | "failed"
      markdown?: string
      metadata?: Record<string, unknown>
      error?: string
      contentHash?: string
    }
  | {
      kind: "job_complete"
      serviceJobId: string
      finishReason: string
      stats: {
        visited?: number
        failed?: number
        skipped?: number
        files?: number
      }
    }
  | { kind: "ignored"; event: string }
