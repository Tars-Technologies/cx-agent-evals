"use node"

/**
 * Batch web scraping and page fetching as Convex actions.
 *
 * Actions live here ("use node") because they import HTTP scraper dependencies
 * that rely on Node.js built-ins unavailable in the Convex edge runtime.
 */
import {
  ContentScraper,
  filterLinks,
  normalizeUrl
} from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"

const TIME_BUDGET_MS = 9 * 60 * 1000 // 9 minutes (1 min buffer before Convex 10-min timeout)
const BATCH_SIZE = 10

export const batchScrape = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const startTime = Date.now()
    const scraper = new ContentScraper()

    while (Date.now() - startTime < TIME_BUDGET_MS - 30_000) {
      // Check if job was cancelled
      const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
        jobId: args.crawlJobId
      })
      if (!job || job.status === "cancelled") return

      // Check maxPages limit
      const maxPages = job.config.maxPages ?? 100
      if (job.stats.scraped >= maxPages) return

      // Get batch of pending URLs
      const pendingUrls = await ctx.runQuery(internal.kb.crawl.getPendingUrls, {
        crawlJobId: args.crawlJobId,
        limit: BATCH_SIZE
      })

      if (pendingUrls.length === 0) return

      // Mark batch as scraping
      await ctx.runMutation(internal.kb.crawl.markUrlsScraping, {
        urlIds: pendingUrls.map((u: any) => u._id)
      })

      // Scrape batch with concurrency
      const concurrency = job.config.concurrency ?? 3
      const chunks = []
      for (let i = 0; i < pendingUrls.length; i += concurrency) {
        chunks.push(pendingUrls.slice(i, i + concurrency))
      }

      for (const chunk of chunks) {
        // Rate limiting delay
        const delay = job.config.delay ?? 0
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        const results = await Promise.allSettled(
          chunk.map(async (urlDoc: any) => {
            try {
              const scraped = await scraper.scrape(urlDoc.url, {
                onlyMainContent: job.config.onlyMainContent ?? true,
                timeout: 30_000
              })

              // Filter discovered links
              const filteredLinks = filterLinks(
                scraped.metadata.links,
                job.startUrl,
                {
                  includePaths: job.config.includePaths,
                  excludePaths: job.config.excludePaths,
                  allowSubdomains: job.config.allowSubdomains
                }
              )

              // Prepare discovered URLs with normalized forms
              const discoveredUrls = filteredLinks.map((link: string) => ({
                url: link,
                normalizedUrl: normalizeUrl(link),
                depth: urlDoc.depth + 1,
                parentUrl: urlDoc.url
              }))

              // Persist the scraped page
              await ctx.runMutation(internal.kb.crawl.persistScrapedPage, {
                crawlJobId: args.crawlJobId,
                crawlUrlId: urlDoc._id,
                title: scraped.metadata.title || urlDoc.url,
                content: scraped.markdown,
                sourceUrl: urlDoc.url,
                discoveredUrls
              })
            } catch (error: any) {
              // Mark URL as failed
              await ctx.runMutation(internal.kb.crawl.markUrlFailed, {
                crawlJobId: args.crawlJobId,
                crawlUrlId: urlDoc._id,
                error: error.message || "Unknown error"
              })
            }
          })
        )
      }

      // Check time budget
      if (Date.now() - startTime >= TIME_BUDGET_MS - 30_000) return
    }
  }
})
