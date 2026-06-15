"use node"

/**
 * Batch web scraping and page fetching as Convex actions.
 *
 * Actions live here ("use node") because they import HTTP scraper dependencies
 * that rely on Node.js built-ins unavailable in the Convex edge runtime.
 */
import {
  assertHostResolvesPublic,
  assertPublicHttpUrl,
  filterLinks,
  JobNotReadyError,
  makeScraper,
  normalizeUrl
} from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { backendConfig } from "../config"
import {
  ASIMOV_POLL_DEADLINE_MS,
  ASIMOV_REPOLL_DELAY_MS,
  tarserCallbackUrl
} from "./providers"

const TIME_BUDGET_MS = 9 * 60 * 1000 // 9 minutes (1 min buffer before Convex 10-min timeout)
const BATCH_SIZE = 10

// Mirrors crawl.ts: a poll loop must stop once the job reaches any terminal state
// (cancelled by the user, or finalized by the staleness reaper), not just "cancelled".
const TERMINAL_CRAWL_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled"
])

export const batchScrape = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const startTime = Date.now()
    const scraper = makeScraper()

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

        await Promise.allSettled(
          chunk.map(async (urlDoc: any) => {
            try {
              const scraped = await scraper.scrapePage(urlDoc.url, {
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

export const submitTarserCrawl = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
      jobId: args.crawlJobId
    })
    if (!job || job.status === "cancelled") return
    const tarser = backendConfig.tarser
    if (!tarser) {
      await ctx.runMutation(internal.kb.crawl.markTarserFailed, {
        crawlJobId: args.crawlJobId,
        error: "Tarser is not configured"
      })
      return
    }
    const scraper = makeScraper({ backend: "tarser", ...tarser })
    try {
      // SSRF: reject private/loopback/metadata before handing the URL to Tarser.
      // assertPublicHttpUrl is string-only, so also resolve the host and check
      // each IP (a public DNS name can still point at an internal address),
      // matching the in-process scraper's guard.
      const startHost = assertPublicHttpUrl(job.startUrl).hostname
      await assertHostResolvesPublic(startHost)
      const { serviceJobId } = await scraper.startCrawl({
        startUrl: job.startUrl,
        config: {
          maxPages: job.config.maxPages,
          maxDepth: job.config.maxDepth,
          includePaths: job.config.includePaths,
          excludePaths: job.config.excludePaths,
          allowSubdomains: job.config.allowSubdomains,
          crawlMode: "http"
        },
        callbackUrl: tarserCallbackUrl(job.callbackToken ?? "")
      })
      await ctx.runMutation(internal.kb.crawl.attachServiceJob, {
        crawlJobId: args.crawlJobId,
        serviceJobId
      })
    } catch (error) {
      await ctx.runMutation(internal.kb.crawl.markTarserFailed, {
        crawlJobId: args.crawlJobId,
        error: error instanceof Error ? error.message : "Tarser submit failed"
      })
    }
  }
})

export const cancelTarserCrawl = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
      jobId: args.crawlJobId
    })
    const tarser = backendConfig.tarser
    if (!job?.serviceJobId || !tarser) return
    const scraper = makeScraper({ backend: "tarser", ...tarser })
    await scraper.cancel(job.serviceJobId)
  }
})

// ─── Asimov (poll-based) crawl ───

export const submitAsimovCrawl = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
      jobId: args.crawlJobId
    })
    if (!job || job.status === "cancelled") return
    const asimov = backendConfig.asimov
    if (!asimov) {
      await ctx.runMutation(internal.kb.crawl.markTarserFailed, {
        crawlJobId: args.crawlJobId,
        error: "Asimov is not configured"
      })
      return
    }
    const scraper = makeScraper({ backend: "asimov", ...asimov })
    try {
      // SSRF: reject private/loopback/metadata before handing the URL to Asimov
      // (Asimov's own guard ships log-only first), mirroring the Tarser submit.
      const startHost = assertPublicHttpUrl(job.startUrl).hostname
      await assertHostResolvesPublic(startHost)
      const { serviceJobId } = await scraper.startCrawl({
        startUrl: job.startUrl,
        config: {
          maxPages: job.config.maxPages,
          maxDepth: job.config.maxDepth,
          includePaths: job.config.includePaths,
          excludePaths: job.config.excludePaths,
          allowSubdomains: job.config.allowSubdomains
          // crawlMode is omitted: the Asimov adapter ignores it (web-loader only).
        },
        // Asimov polls — no callback. callbackUrl is required by the port but ignored.
        callbackUrl: ""
      })
      await ctx.runMutation(internal.kb.crawl.attachServiceJob, {
        crawlJobId: args.crawlJobId,
        serviceJobId
      })
      // Kick off the poll loop (no callback route exists for asimov).
      await ctx.scheduler.runAfter(
        0,
        internal.kb.crawl_actions.pollAsimovCrawl,
        { crawlJobId: args.crawlJobId }
      )
    } catch (error) {
      await ctx.runMutation(internal.kb.crawl.markTarserFailed, {
        crawlJobId: args.crawlJobId,
        error: error instanceof Error ? error.message : "Asimov submit failed"
      })
    }
  }
})

/**
 * Poll an Asimov crawl to completion, then feed the existing Tarser crawl
 * mutations (handleTarserPage / handleTarserPageFailed / handleTarserJobComplete)
 * with the drained pages — reusing the same idempotent ingestion path. Self-
 * reschedules while the crawl is still running (JobNotReadyError). No callback
 * route exists for asimov.
 */
export const pollAsimovCrawl = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
      jobId: args.crawlJobId
    })
    // Stop once the job reached any terminal state (cancelled by the user or
    // finalized by the reaper) — otherwise the poll loop hammers Asimov forever.
    if (!job || TERMINAL_CRAWL_STATUSES.has(job.status)) return
    const asimov = backendConfig.asimov
    if (!asimov || !job.serviceJobId) {
      await ctx.runMutation(internal.kb.crawl.markAsimovCrawlFailed, {
        crawlJobId: args.crawlJobId,
        error: "Asimov is not configured or job was not submitted"
      })
      return
    }
    const scraper = makeScraper({
      backend: "asimov",
      ...asimov,
      pollDeadlineMs: ASIMOV_POLL_DEADLINE_MS
    })
    // getResult is optional on the Scraper port (only poll-based backends
    // implement it). The asimov backend always does; guard for type-safety.
    if (!scraper.getResult) {
      await ctx.runMutation(internal.kb.crawl.markAsimovCrawlFailed, {
        crawlJobId: args.crawlJobId,
        error: "Configured scraper backend does not support polling"
      })
      return
    }
    let result: Awaited<ReturnType<NonNullable<typeof scraper.getResult>>>
    try {
      result = await scraper.getResult(job.serviceJobId, "crawl")
    } catch (error) {
      if (error instanceof JobNotReadyError) {
        // Heartbeat so the staleness reaper doesn't kill a healthy long crawl,
        // then re-poll on the next tick.
        await ctx.runMutation(internal.kb.crawl.touchCrawlActivity, {
          crawlJobId: args.crawlJobId
        })
        await ctx.scheduler.runAfter(
          ASIMOV_REPOLL_DELAY_MS,
          internal.kb.crawl_actions.pollAsimovCrawl,
          { crawlJobId: args.crawlJobId }
        )
        return
      }
      await ctx.runMutation(internal.kb.crawl.markAsimovCrawlFailed, {
        crawlJobId: args.crawlJobId,
        error:
          error instanceof Error ? error.message : "Asimov crawl poll failed"
      })
      return
    }
    if (result.kind !== "crawl") {
      await ctx.runMutation(internal.kb.crawl.markAsimovCrawlFailed, {
        crawlJobId: args.crawlJobId,
        error: "Asimov returned a non-crawl result for a crawl job"
      })
      return
    }
    // Ingest through the existing idempotent crawl-page mutations. Wrap the whole
    // phase so a transient error doesn't leave the job stuck "running" with no
    // completion (the action has no WorkPool auto-retry).
    try {
      for (const page of result.pages) {
        await ctx.runMutation(internal.kb.crawl.handleTarserPage, {
          crawlJobId: args.crawlJobId,
          url: page.url,
          title: page.metadata.title || page.url,
          markdown: page.markdown
        })
      }
      for (const fail of result.failed) {
        await ctx.runMutation(internal.kb.crawl.handleTarserPageFailed, {
          crawlJobId: args.crawlJobId,
          url: fail.url,
          error: fail.error
        })
      }
      await ctx.runMutation(internal.kb.crawl.handleTarserJobComplete, {
        crawlJobId: args.crawlJobId,
        finishReason: result.finishReason,
        stats: {
          visited: result.pages.length,
          failed: result.failed.length
        }
      })
    } catch (error) {
      await ctx.runMutation(internal.kb.crawl.markAsimovCrawlFailed, {
        crawlJobId: args.crawlJobId,
        error:
          error instanceof Error ? error.message : "Asimov crawl ingest failed"
      })
    }
  }
})

export const cancelAsimovCrawl = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.kb.crawl.getJobInternal, {
      jobId: args.crawlJobId
    })
    const asimov = backendConfig.asimov
    if (!job?.serviceJobId || !asimov) return
    const scraper = makeScraper({ backend: "asimov", ...asimov })
    await scraper.cancel(job.serviceJobId)
  }
})
