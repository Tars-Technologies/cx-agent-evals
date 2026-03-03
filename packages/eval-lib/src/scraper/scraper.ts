import { gotScraping } from "got-scraping";
import { htmlToMarkdown } from "../file-processing/html-to-markdown.js";
import type { ScrapedPage, ScrapeOptions } from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; KBDataSourcing/1.0; +https://github.com/vinit-agr/cx-agent-evals)";
const DEFAULT_TIMEOUT = 30_000;

export class ContentScraper {
  private userAgent: string;
  private defaultHeaders: Record<string, string>;

  constructor(config?: {
    userAgent?: string;
    defaultHeaders?: Record<string, string>;
  }) {
    this.userAgent = config?.userAgent ?? DEFAULT_USER_AGENT;
    this.defaultHeaders = config?.defaultHeaders ?? {};
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    const response = await gotScraping({
      url,
      timeout: { request: timeout },
      headers: {
        "User-Agent": this.userAgent,
        ...this.defaultHeaders,
        ...options?.headers,
      },
    });

    const html = response.body as string;
    const statusCode = response.statusCode ?? 200;

    const processed = await htmlToMarkdown(html, {
      onlyMainContent: options?.onlyMainContent ?? true,
      includeLinks: options?.includeLinks ?? true,
      baseUrl: url,
    });

    return {
      url,
      markdown: processed.content,
      metadata: {
        title: processed.title,
        sourceURL: url,
        statusCode,
        links: processed.metadata.links ?? [],
      },
    };
  }
}
