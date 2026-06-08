import type { ScrapedPage, ScrapeOptions } from "./types.js"

/** Thrown by a provider method that a given backend does not support. */
export class NotSupportedError extends Error {
  constructor(method: string, backend: string) {
    super(`${method} is not supported by the "${backend}" backend`)
    this.name = "NotSupportedError"
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
  parserPreference?: "docling" | "pymupdf"
  ocr?: boolean
  captionImages?: boolean
  ocrProvider?: string
}

export interface Scraper {
  readonly name: string
  checkHealth(): Promise<boolean>
  startCrawl(args: {
    startUrl: string
    config: ScraperCrawlConfig
    callbackUrl: string
  }): Promise<{ serviceJobId: string }>
  cancel(serviceJobId: string): Promise<void>
}

export interface Parser {
  readonly name: string
  checkHealth(): Promise<boolean>
  startParse(args: {
    fileUrl: string
    mimeType: string
    options?: ParseOptions
    callbackUrl: string
  }): Promise<{ serviceJobId: string }>
  cancel(serviceJobId: string): Promise<void>
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

export type ParserConfig =
  | { backend?: "inprocess" }
  | { backend: "tarser"; baseUrl: string; apiToken: string; hmacSecret: string }

/** Normalized form of a Tarser callback after PythonContentService.normalizeCallback(). */
export type NormalizedCallback =
  | { kind: "page"; serviceJobId: string; url: string; markdown: string; title?: string; depth?: number; contentHash?: string }
  | { kind: "page_failed"; serviceJobId: string; url: string; error?: string; finishReason: string; errorCategory?: string }
  | { kind: "discovered_file"; serviceJobId: string; fileUrl: string; sourcePage?: string }
  | { kind: "parsed"; serviceJobId: string; status: "ok" | "failed"; markdown?: string; metadata?: Record<string, unknown>; error?: string; contentHash?: string }
  | { kind: "job_complete"; serviceJobId: string; finishReason: string; stats: { visited?: number; failed?: number; skipped?: number; files?: number } }
  | { kind: "ignored"; event: string }
