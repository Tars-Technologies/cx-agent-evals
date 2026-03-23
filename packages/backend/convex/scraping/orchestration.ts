import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { Workpool, WorkId, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "../lib/auth";
import { Id } from "../_generated/dataModel";

// ─── WorkPool Instance ───

const pool = new Workpool(components.scrapingPool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 5000,
    base: 2,
  },
});

// ─── Start Crawl ───

export const startCrawl = mutation({
  args: {
    kbId: v.id("knowledgeBases"),
    startUrl: v.string(),
    config: v.optional(v.object({
      maxDepth: v.optional(v.number()),
      maxPages: v.optional(v.number()),
      includePaths: v.optional(v.array(v.string())),
      excludePaths: v.optional(v.array(v.string())),
      allowSubdomains: v.optional(v.boolean()),
      onlyMainContent: v.optional(v.boolean()),
      delay: v.optional(v.number()),
      concurrency: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    const userConfig = args.config ?? {};
    const config = {
      maxDepth: userConfig.maxDepth ?? 3,
      maxPages: userConfig.maxPages ?? 200,
      includePaths: userConfig.includePaths,
      excludePaths: userConfig.excludePaths,
      allowSubdomains: userConfig.allowSubdomains ?? false,
      onlyMainContent: userConfig.onlyMainContent ?? true,
      delay: userConfig.delay ?? 0,
      concurrency: userConfig.concurrency ?? 3,
    };

    // Create crawl job
    const jobId = await ctx.db.insert("crawlJobs", {
      orgId,
      kbId: args.kbId,
      userId: user._id,
      startUrl: args.startUrl,
      config,
      status: "running",
      stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
      createdAt: Date.now(),
    });

    // Normalize the start URL for dedup
    const normalizedUrl = args.startUrl.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "") || args.startUrl;

    // Insert seed URL into frontier
    await ctx.db.insert("crawlUrls", {
      crawlJobId: jobId,
      url: args.startUrl,
      normalizedUrl,
      status: "pending",
      depth: 0,
    });

    // Enqueue the first batch scrape action
    const workId = await pool.enqueueAction(
      ctx,
      internal.scraping.actions.batchScrape,
      { crawlJobId: jobId },
      {
        context: { jobId },
        onComplete: internal.scraping.orchestration.onBatchComplete,
      },
    );

    return jobId;
  },
});

// ─── Cancel Crawl ───

export const cancelCrawl = mutation({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) {
      throw new Error("Crawl job not found");
    }
    if (job.status !== "running" && job.status !== "pending") {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "cancelled" });
  },
});

// ─── Public Queries ───

export const getJob = query({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) return null;
    return job;
  },
});

export const listByKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});

// ─── Internal Queries ───

export const getJobInternal = internalQuery({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const getPendingUrls = internalQuery({
  args: {
    crawlJobId: v.id("crawlJobs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("status", "pending"),
      )
      .take(args.limit ?? 20);
  },
});

// ─── Internal Mutations ───

export const markUrlsScraping = internalMutation({
  args: {
    urlIds: v.array(v.id("crawlUrls")),
  },
  handler: async (ctx, args) => {
    for (const urlId of args.urlIds) {
      await ctx.db.patch(urlId, { status: "scraping" });
    }
  },
});

export const persistScrapedPage = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    crawlUrlId: v.id("crawlUrls"),
    title: v.string(),
    content: v.string(),
    sourceUrl: v.string(),
    discoveredUrls: v.array(v.object({
      url: v.string(),
      normalizedUrl: v.string(),
      depth: v.number(),
      parentUrl: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.crawlJobId);
    if (!job) return;

    // Create document via createFromScrape
    const documentId = await ctx.runMutation(internal.crud.documents.createFromScrape, {
      orgId: job.orgId,
      kbId: job.kbId,
      title: args.title,
      content: args.content,
      sourceUrl: args.sourceUrl,
      sourceType: "scraped",
    });

    // Mark URL as done
    await ctx.db.patch(args.crawlUrlId, {
      status: "done",
      documentId,
      scrapedAt: Date.now(),
    });

    // Insert discovered URLs (dedup via by_job_url index)
    let newDiscovered = 0;
    const maxPages = job.config.maxPages ?? 100;

    for (const discovered of args.discoveredUrls) {
      // Check maxPages limit
      if (job.stats.discovered + newDiscovered >= maxPages) break;

      // Dedup: check if this URL already exists for this job
      const existing = await ctx.db
        .query("crawlUrls")
        .withIndex("by_job_url", (q) =>
          q.eq("crawlJobId", args.crawlJobId).eq("normalizedUrl", discovered.normalizedUrl),
        )
        .first();
      if (existing) continue;

      // Check depth limit
      const maxDepth = job.config.maxDepth ?? 3;
      if (discovered.depth > maxDepth) continue;

      await ctx.db.insert("crawlUrls", {
        crawlJobId: args.crawlJobId,
        url: discovered.url,
        normalizedUrl: discovered.normalizedUrl,
        status: "pending",
        depth: discovered.depth,
        parentUrl: discovered.parentUrl,
      });
      newDiscovered++;
    }

    // Update stats
    await ctx.db.patch(args.crawlJobId, {
      stats: {
        discovered: job.stats.discovered + newDiscovered,
        scraped: job.stats.scraped + 1,
        failed: job.stats.failed,
        skipped: job.stats.skipped,
      },
    });
  },
});

export const markUrlFailed = internalMutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    crawlUrlId: v.id("crawlUrls"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const urlDoc = await ctx.db.get(args.crawlUrlId);
    if (!urlDoc) return;

    const retryCount = (urlDoc.retryCount ?? 0) + 1;
    await ctx.db.patch(args.crawlUrlId, {
      status: "failed",
      error: args.error,
      retryCount,
    });

    // Update job stats
    const job = await ctx.db.get(args.crawlJobId);
    if (!job) return;
    await ctx.db.patch(args.crawlJobId, {
      stats: {
        ...job.stats,
        failed: job.stats.failed + 1,
      },
    });
  },
});

// ─── onBatchComplete Callback ───

export const onBatchComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("crawlJobs"),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"crawlJobs"> };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;

    // If the action itself failed (not individual URLs), mark job failed
    if (result.kind === "failed") {
      await ctx.db.patch(context.jobId, {
        status: "failed",
        error: result.error,
        completedAt: Date.now(),
      });
      return;
    }

    // If cancelled, don't continue
    if (job.status === "cancelled") {
      await ctx.db.patch(context.jobId, { completedAt: Date.now() });
      return;
    }

    // Check if there are still pending URLs
    const pendingUrls = await ctx.db
      .query("crawlUrls")
      .withIndex("by_job_status", (q) =>
        q.eq("crawlJobId", context.jobId).eq("status", "pending"),
      )
      .first();

    // Check maxPages limit
    const maxPages = job.config.maxPages ?? 100;
    const atLimit = job.stats.scraped >= maxPages;

    if (pendingUrls && !atLimit) {
      // More work to do — enqueue another batch
      await pool.enqueueAction(
        ctx,
        internal.scraping.actions.batchScrape,
        { crawlJobId: context.jobId },
        {
          context: { jobId: context.jobId },
          onComplete: internal.scraping.orchestration.onBatchComplete,
        },
      );
    } else {
      // Done — determine final status based on stats
      const { scraped, failed } = job.stats;
      let finalStatus: "completed" | "completed_with_errors" | "failed";
      let error: string | undefined;

      if (scraped === 0 && failed > 0) {
        finalStatus = "failed";
        error = `All ${failed} URL(s) failed to scrape`;
      } else if (failed > 0) {
        finalStatus = "completed_with_errors";
      } else {
        finalStatus = "completed";
      }

      await ctx.db.patch(context.jobId, {
        status: finalStatus,
        ...(error && { error }),
        completedAt: Date.now(),
      });
    }
  },
});
