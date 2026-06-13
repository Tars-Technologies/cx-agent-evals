import type {
  ParserJobResult,
  Scraper,
  ScraperCrawlConfig,
  ScraperJobResult
} from "./ports.js"
import { NotSupportedError } from "./ports.js"
import { ContentScraper, type ContentScraperConfig } from "./scraper.js"
import type { ScrapedPage, ScrapeOptions } from "./types.js"

/**
 * In-process scraper. Wraps ContentScraper for single-page scraping. The whole-crawl
 * startCrawl() is intentionally unsupported: for the in-process backend the Convex
 * WorkPool loop owns the frontier and drives scrapePage() one URL at a time.
 */
export class InProcessScraper implements Scraper {
  readonly name = "inprocess"
  private readonly scraper: ContentScraper

  constructor(config?: ContentScraperConfig) {
    this.scraper = new ContentScraper(config)
  }

  async checkHealth(): Promise<boolean> {
    return true
  }

  async scrapePage(url: string, options?: ScrapeOptions): Promise<ScrapedPage> {
    return this.scraper.scrape(url, options)
  }

  async startCrawl(_args: {
    startUrl: string
    config: ScraperCrawlConfig
    callbackUrl: string
  }): Promise<{ serviceJobId: string }> {
    throw new NotSupportedError("startCrawl", this.name)
  }

  async cancel(_serviceJobId: string): Promise<void> {
    // No remote job to cancel; cancellation is handled by the host WorkPool/job state.
  }

  async getResult(
    _serviceJobId: string,
    _expectedKind?: "crawl" | "parse"
  ): Promise<ScraperJobResult | ParserJobResult> {
    // The in-process WorkPool loop owns results page-by-page; there is no polled job.
    throw new NotSupportedError("getResult", this.name)
  }
}
