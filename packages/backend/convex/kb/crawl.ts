/**
 * Web-crawl job queries, mutations, and internal helpers.
 *
 * Owns the crawl WorkPool; batch scraping and page fetching are delegated
 * to crawl_actions.ts because they import HTTP scraper dependencies.
 */
import { type RunResult, vOnCompleteArgs, Workpool } from "@convex-dev/workpool"
import { normalizeUrl } from "@tars-inc/eval-lib/scraper/link-extractor"
import { v } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"

// Finish reasons that represent a clean crawl completion. Anything else
// (timeout, site_failure, ...) is treated as an abnormal end.
const NORMAL_FINISH_REASONS = new Set(["finished", "completed", "ok", "done"])

// Terminal crawl-job statuses. Tarser delivery is at-least-once, so a per-page
// callback can arrive after job_complete or after the reaper finalized the job.
// Every callback handler bails when the job is already terminal so a late/duplicate
// callback can't re-ingest documents or resurrect a finished job (mirrors
// finishParse's parseStatus guard on the parse path).
const TERMINAL_CRAWL_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled"
])

// Tarser crawls with no callback activity past this are presumed abandoned and
// swept to a terminal status by the reaper cron.
const CRAWL_STALE_MS = 30 * 60 * 1000

// Max rows a single reaper run sweeps, so a large backlog can't blow the
// per-transaction limits. Remaining rows are drained on subsequent cron ticks.
const REAP_BATCH = 200

// ─── WorkPool Instance ───

const pool = new Workpool(components.scrapingPool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    base: 2
  }
})

// ─── Start Crawl ───

export const startCrawl = tenantMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    startUrl: v.string(),
    config: v.optional(
      v.object({
        maxDepth: v.optional(v.number()),
        maxPages: v.optional(v.number()),
        includePaths: v.optional(v.array(v.string())),
        excludePaths: v.optional(v.array(v.string())),
        allowSubdomains: v.optional(v.boolean()),
        onlyMainContent: v.optional(v.boolean()),
        delay: v.optional(v.number()),
        concurrency: v.optional(v.number())
      })
    ),
    backend: v.optional(v.union(v.literal("inprocess"), v.literal("tarser")))
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = ctx

    // Normalize + validate the start URL. Bare domains get https://; only http(s) allowed.
    // (Private/metadata host blocking is enforced downstream: at fetch time for the in-process
    // scraper, and via the eval-lib guard on the Tarser submit path.)
    let startUrl = args.startUrl.trim()
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(startUrl)) {
      startUrl = `https://${startUrl}`
    }
    let parsedStart: URL
    try {
      parsedStart = new URL(startUrl)
    } catch {
      throw new Error(`Invalid start URL: ${args.startUrl}`)
    }
    if (parsedStart.protocol !== "http:" && parsedStart.protocol !== "https:") {
      throw new Error(`Unsupported start URL scheme: ${parsedStart.protocol}`)
    }
    startUrl = parsedStart.toString()

    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }

    const userConfig = args.config ?? {}
    const config = {
      maxDepth: userConfig.maxDepth ?? 3,
      maxPages: userConfig.maxPages ?? 200,
      includePaths: userConfig.includePaths,
      excludePaths: userConfig.excludePaths,
      allowSubdomains: userConfig.allowSubdomains ?? false,
      onlyMainContent: userConfig.onlyMainContent ?? true,
      delay: userConfig.delay ?? 0,
      concurrency: userConfig.concurrency ?? 3
    }

    const backend = args.backend ?? "inprocess"
    const callbackToken = crypto.randomUUID()

    // Create crawl job
    const jobId = await ctx.db.insert("crawlJobs", {
      orgId,
      kbId: args.kbId,
      userId,
      startUrl,
      config,
      status: backend === "tarser" ? "pending" : "running",
      stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
      backend,
      callbackToken,
      createdAt: Date.now()
    })

    if (backend === "inprocess") {
      // Normalize the start URL for dedup (same form as discovered URLs)
      const normalizedUrl = normalizeUrl(startUrl)

      // Insert seed URL into frontier
      await ctx.db.insert("crawlUrls", {
        crawlJobId: jobId,
        url: startUrl,
        normalizedUrl,
        status: "pending",
        depth: 0
      })

      // Enqueue the first batch scrape action
      await pool.enqueueAction(
        ctx,
        internal.kb.crawl_actions.batchScrape,
        { crawlJobId: jobId },
        {
          context: { jobId },
          onComplete: internal.kb.crawl.onBatchComplete
        }
      )
    } else {
      // Tarser owns the frontier remotely; submit once (no crawlUrls seed).
      await ctx.scheduler.runAfter(
        0,
        internal.kb.crawl_actions.submitTarserCrawl,
        { crawlJobId: jobId }
      )
    }

    return jobId
  }
})

// ─── Cancel Crawl ───

export const cancelCrawl = tenantMutation({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const job = await ctx.db.get(args.jobId)
    if (!job || job.orgId !== orgId) {
      throw new Error("Crawl job not found")
    }
    if (job.status !== "running" && job.status !== "pending") {
      throw new Error(`Cannot cancel job in status: ${job.status}`)
    }
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      cancelRequestedAt: Date.now()
    })
    if (job.backend === "tarser" && job.serviceJobId) {
      await ctx.scheduler.runAfter(
        0,
        internal.kb.crawl_actions.cancelTarserCrawl,
        { crawlJobId: args.jobId }
      )
    }
  }
})

// ─── Public Queries ───

export const getJob = tenantQuery({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const job = await ctx.db.get(args.jobId)
    if (!job || job.orgId !== orgId) return null
    return job
  }
})

export const listByKb = tenantQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect()
  }
})

// ─── Internal Queries ───

export const getJobInternal = internalQuery({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId)
  }
})

export const getPendingUrls = internalQuery({
  args: {
    crawlJobId: v.id("crawlJobs"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("status", "pending")
      )
      .take(args.limit ?? 20)
  }
})

// ─── Internal Mutations ───

export const markUrlsScraping = internalMutation({
  args: {
    urlIds: v.array(v.id("crawlUrls"))
  },
  handler: async (ctx, args) => {
    for (const urlId of args.urlIds) {
      await ctx.db.patch(urlId, { status: "scraping" })
    }
  }
})

export const persistScrapedPage = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    crawlUrlId: v.id("crawlUrls"),
    title: v.string(),
    content: v.string(),
    sourceUrl: v.string(),
    discoveredUrls: v.array(
      v.object({
        url: v.string(),
        normalizedUrl: v.string(),
        depth: v.number(),
        parentUrl: v.string()
      })
    )
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.crawlJobId)
    if (!job) return

    // Create document via createFromScrape
    const documentId = await ctx.runMutation(
      internal.kb.documents.createFromScrape,
      {
        orgId: job.orgId,
        kbId: job.kbId,
        title: args.title,
        content: args.content,
        sourceUrl: args.sourceUrl,
        sourceType: "scraped"
      }
    )

    // Mark URL as done
    await ctx.db.patch(args.crawlUrlId, {
      status: "done",
      documentId,
      scrapedAt: Date.now()
    })

    // Insert discovered URLs (dedup via by_job_url index)
    let newDiscovered = 0
    const maxPages = job.config.maxPages ?? 100

    for (const discovered of args.discoveredUrls) {
      // Check maxPages limit
      if (job.stats.discovered + newDiscovered >= maxPages) break

      // Dedup: check if this URL already exists for this job
      const existing = await ctx.db
        .query("crawlUrls")
        .withIndex("by_job_url", (q) =>
          q
            .eq("crawlJobId", args.crawlJobId)
            .eq("normalizedUrl", discovered.normalizedUrl)
        )
        .first()
      if (existing) continue

      // Check depth limit
      const maxDepth = job.config.maxDepth ?? 3
      if (discovered.depth > maxDepth) continue

      await ctx.db.insert("crawlUrls", {
        crawlJobId: args.crawlJobId,
        url: discovered.url,
        normalizedUrl: discovered.normalizedUrl,
        status: "pending",
        depth: discovered.depth,
        parentUrl: discovered.parentUrl
      })
      newDiscovered++
    }

    // Update stats
    await ctx.db.patch(args.crawlJobId, {
      stats: {
        discovered: job.stats.discovered + newDiscovered,
        scraped: job.stats.scraped + 1,
        failed: job.stats.failed,
        skipped: job.stats.skipped
      }
    })
  }
})

export const markUrlFailed = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    crawlUrlId: v.id("crawlUrls"),
    error: v.string()
  },
  handler: async (ctx, args) => {
    const urlDoc = await ctx.db.get(args.crawlUrlId)
    if (!urlDoc) return

    const retryCount = (urlDoc.retryCount ?? 0) + 1
    await ctx.db.patch(args.crawlUrlId, {
      status: "failed",
      error: args.error,
      retryCount
    })

    // Update job stats
    const job = await ctx.db.get(args.crawlJobId)
    if (!job) return
    await ctx.db.patch(args.crawlJobId, {
      stats: {
        ...job.stats,
        failed: job.stats.failed + 1
      }
    })
  }
})

// ─── onBatchComplete Callback ───

export const onBatchComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("crawlJobs")
    })
  ),
  handler: async (
    ctx,
    {
      context,
      result
    }: {
      workId: string
      context: { jobId: Id<"crawlJobs"> }
      result: RunResult
    }
  ) => {
    const job = await ctx.db.get(context.jobId)
    if (!job) return

    // If the action itself failed (not individual URLs), mark job failed
    if (result.kind === "failed") {
      await ctx.db.patch(context.jobId, {
        status: "failed",
        error: result.error,
        completedAt: Date.now()
      })
      return
    }

    // If cancelled, don't continue
    if (job.status === "cancelled") {
      await ctx.db.patch(context.jobId, { completedAt: Date.now() })
      return
    }

    // Check if there are still pending URLs
    const pendingUrls = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", context.jobId).eq("status", "pending")
      )
      .first()

    // Check maxPages limit
    const maxPages = job.config.maxPages ?? 100
    const atLimit = job.stats.scraped >= maxPages

    if (pendingUrls && !atLimit) {
      // More work to do — enqueue another batch
      await pool.enqueueAction(
        ctx,
        internal.kb.crawl_actions.batchScrape,
        { crawlJobId: context.jobId },
        {
          context: { jobId: context.jobId },
          onComplete: internal.kb.crawl.onBatchComplete
        }
      )
    } else {
      // Done — determine final status based on stats
      const { scraped, failed } = job.stats
      let finalStatus: "completed" | "completed_with_errors" | "failed"
      let error: string | undefined

      if (scraped === 0 && failed > 0) {
        finalStatus = "failed"
        error = `All ${failed} URL(s) failed to scrape`
      } else if (failed > 0) {
        finalStatus = "completed_with_errors"
      } else {
        finalStatus = "completed"
      }

      await ctx.db.patch(context.jobId, {
        status: finalStatus,
        ...(error && { error }),
        completedAt: Date.now()
      })
    }
  }
})

// ─── Tarser submit support ───

export const attachServiceJob = internalMutation({
  args: { crawlJobId: v.id("crawlJobs"), serviceJobId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.crawlJobId, {
      serviceJobId: args.serviceJobId,
      submittedAt: Date.now(),
      status: "running"
    })
  }
})

export const markTarserFailed = internalMutation({
  args: { crawlJobId: v.id("crawlJobs"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.crawlJobId, {
      status: "failed",
      error: args.error,
      completedAt: Date.now()
    })
  }
})

// ─── Tarser callback dispatch (called by http.ts after HMAC verify) ───

export const getJobByServiceJob = internalQuery({
  args: { serviceJobId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_service_job", (q) =>
        q.eq("serviceJobId", args.serviceJobId)
      )
      .first()
  }
})

export const handleTarserPage = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    url: v.string(),
    title: v.string(),
    markdown: v.string()
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.crawlJobId)
    if (!job) return
    // Ignore late/duplicate callbacks once the job is terminal.
    if (TERMINAL_CRAWL_STATUSES.has(job.status)) return
    // A page callback with no url can't be attributed or deduped (normalizeUrl("")
    // == ""); treat it as a no-op rather than inserting an orphan document.
    if (args.url.trim().length === 0) return
    const normalizedUrl = normalizeUrl(args.url)
    // Idempotency: skip if a crawlUrl for this normalized URL is already done.
    const existing = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_url", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("normalizedUrl", normalizedUrl)
      )
      .first()
    if (existing && (existing.status === "done" || existing.documentId)) return

    // An empty page is a failure, not a document (parity with finishParse, which
    // treats ok+empty as failed). Record it and bump the failed counter.
    if (args.markdown.trim().length === 0) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "failed",
          error: "Empty page (no content)",
          callbackReceivedAt: Date.now()
        })
      } else {
        await ctx.db.insert("crawlUrls", {
          crawlJobId: args.crawlJobId,
          url: args.url,
          normalizedUrl,
          status: "failed",
          depth: 0,
          error: "Empty page (no content)",
          callbackReceivedAt: Date.now()
        })
      }
      await ctx.db.patch(args.crawlJobId, {
        stats: { ...job.stats, failed: job.stats.failed + 1 },
        lastCallbackAt: Date.now()
      })
      return
    }

    const documentId = await ctx.runMutation(
      internal.kb.documents.createFromScrape,
      {
        orgId: job.orgId,
        kbId: job.kbId,
        title: args.title || args.url,
        content: args.markdown,
        sourceUrl: args.url,
        sourceType: "scraped"
      }
    )

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "done",
        documentId,
        callbackReceivedAt: Date.now()
      })
    } else {
      await ctx.db.insert("crawlUrls", {
        crawlJobId: args.crawlJobId,
        url: args.url,
        normalizedUrl,
        status: "done",
        depth: 0,
        documentId,
        callbackReceivedAt: Date.now()
      })
    }
    await ctx.db.patch(args.crawlJobId, {
      stats: { ...job.stats, scraped: job.stats.scraped + 1 },
      lastCallbackAt: Date.now()
    })
  }
})

export const handleTarserJobComplete = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    finishReason: v.string(),
    stats: v.object({
      visited: v.optional(v.number()),
      failed: v.optional(v.number()),
      skipped: v.optional(v.number()),
      files: v.optional(v.number())
    })
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.crawlJobId)
    // Ignore a duplicate/late job_complete once the job is terminal, so it can't
    // overwrite a reaped "failed" job back to "completed".
    if (!job || TERMINAL_CRAWL_STATUSES.has(job.status)) return
    // Reconcile the remote aggregate with our locally-counted page failures:
    // a remote `failed: 0` must not erase failures recorded via per-page
    // callbacks (handleTarserPageFailed), which would mislabel the job
    // "completed" instead of "completed_with_errors".
    const failed = Math.max(args.stats.failed ?? 0, job.stats.failed)
    const scraped = job.stats.scraped
    // A finishReason other than a normal completion (e.g. timeout, site_failure)
    // means the crawl ended abnormally, so it must not be reported as a clean
    // "completed" even when no individual page failed.
    const abnormal = !NORMAL_FINISH_REASONS.has(args.finishReason)
    const status =
      scraped === 0 && (failed > 0 || abnormal)
        ? "failed"
        : failed > 0 || abnormal
          ? "completed_with_errors"
          : "completed"
    await ctx.db.patch(args.crawlJobId, {
      status,
      finishReason: args.finishReason,
      completedAt: Date.now(),
      lastCallbackAt: Date.now()
    })
  }
})

/** Record a Tarser page failure so it counts toward the job's failed stat. */
export const handleTarserPageFailed = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    url: v.string(),
    error: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.crawlJobId)
    // Ignore late/duplicate failure callbacks once the job is terminal.
    if (!job || TERMINAL_CRAWL_STATUSES.has(job.status)) return
    const normalizedUrl = normalizeUrl(args.url)
    const existing = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_url", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("normalizedUrl", normalizedUrl)
      )
      .first()
    // Don't double-count a URL already recorded as done/failed.
    if (
      existing &&
      (existing.status === "done" || existing.status === "failed")
    )
      return
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "failed",
        error: args.error ?? "Page failed",
        callbackReceivedAt: Date.now()
      })
    } else {
      await ctx.db.insert("crawlUrls", {
        crawlJobId: args.crawlJobId,
        url: args.url,
        normalizedUrl,
        status: "failed",
        depth: 0,
        error: args.error ?? "Page failed",
        callbackReceivedAt: Date.now()
      })
    }
    await ctx.db.patch(args.crawlJobId, {
      stats: { ...job.stats, failed: job.stats.failed + 1 },
      lastCallbackAt: Date.now()
    })
  }
})

/**
 * Reaper: fail Tarser crawl jobs stuck in running/pending with no callback
 * activity past CRAWL_STALE_MS. The in-process backend self-terminates via the
 * WorkPool loop, but a Tarser job only ends on the remote job_complete callback,
 * so an abandoned remote crawl would otherwise hang forever.
 */
export const reapStaleCrawls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CRAWL_STALE_MS
    let reaped = 0
    for (const status of ["running", "pending"] as const) {
      // Scope the bounded batch to Tarser jobs at the index level. Filtering
      // backend after a status-only take() would let never-reaped in-process
      // "running" rows fill the batch and starve stale Tarser crawls forever.
      const jobs = await ctx.db
        .query("crawlJobs")
        .withIndex("by_backend_status", (q) =>
          q.eq("backend", "tarser").eq("status", status)
        )
        .take(REAP_BATCH)
      for (const job of jobs) {
        const lastActivity =
          job.lastCallbackAt ?? job.submittedAt ?? job.createdAt
        if (lastActivity >= cutoff) continue
        const finalStatus =
          job.stats.scraped > 0 ? "completed_with_errors" : "failed"
        await ctx.db.patch(job._id, {
          status: finalStatus,
          finishReason: "reaped: no callback activity",
          error:
            finalStatus === "failed"
              ? "Crawl timed out: no callback activity"
              : undefined,
          completedAt: Date.now()
        })
        reaped++
      }
    }
    return { reaped }
  }
})
