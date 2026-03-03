import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import {
  Workpool,
  vOnCompleteArgs,
  type RunResult,
} from "@convex-dev/workpool";
import { getAuthContext } from "./lib/auth";
import { internalMutation } from "./_generated/server";
import { normalizeUrl } from "rag-evaluation-system";
import { Id } from "./_generated/dataModel";

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
    config: v.optional(
      v.object({
        maxDepth: v.optional(v.number()),
        maxPages: v.optional(v.number()),
        includePaths: v.optional(v.array(v.string())),
        excludePaths: v.optional(v.array(v.string())),
        allowSubdomains: v.optional(v.boolean()),
        onlyMainContent: v.optional(v.boolean()),
        delay: v.optional(v.number()),
        concurrency: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Verify KB ownership
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    // Look up user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    const config = args.config ?? {};

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

    // Insert seed URL
    await ctx.db.insert("crawlUrls", {
      crawlJobId: jobId,
      url: args.startUrl,
      normalizedUrl: normalizeUrl(args.startUrl),
      status: "pending",
      depth: 0,
      retryCount: 0,
    });

    // Enqueue first batch scrape action
    await pool.enqueueAction(
      ctx,
      internal.scrapingActions.batchScrape,
      { crawlJobId: jobId },
      {
        context: { jobId },
        onComplete: internal.scraping.onBatchComplete,
      },
    );

    return { jobId };
  },
});

// ─── Cancel Crawl ───

export const cancelCrawl = mutation({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) throw new Error("Job not found");
    if (job.status !== "running") throw new Error("Job is not running");

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      completedAt: Date.now(),
    });
  },
});

// ─── Crawl Queries ───

export const getCrawlJob = query({
  args: { jobId: v.id("crawlJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) return null;
    return job;
  },
});

export const listCrawlJobs = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .order("desc")
      .collect();
  },
});

// ─── onComplete Callback ───

export const onBatchComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("crawlJobs"),
    }),
  ),
  handler: async (
    ctx,
    { context, result }: {
      workId: string;
      context: { jobId: Id<"crawlJobs"> };
      result: RunResult;
    },
  ) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;

    // If cancelled or already completed, don't continue
    if (job.status === "cancelled" || job.status === "completed") return;

    // If the action itself failed (WorkPool-level), check retries
    if (result.kind !== "success") {
      // WorkPool handles retries; if all retries exhausted, mark job failed
      if (result.kind === "failed") {
        await ctx.db.patch(job._id, {
          status: "failed",
          error: `Batch scrape action failed after retries`,
          completedAt: Date.now(),
        });
      }
      return;
    }

    // Reset failed URLs that haven't exceeded max retries
    await ctx.runMutation(
      internal.scrapingMutations.resetFailedUrlsForRetry,
      { crawlJobId: job._id, maxRetries: 3 },
    );

    // Check if there's more work to do
    const pendingCount = await ctx.runQuery(
      internal.scrapingMutations.countPendingUrls,
      { crawlJobId: job._id },
    );

    const maxPages = (job.config as any).maxPages ?? 100;
    const reachedLimit = job.stats.scraped >= maxPages;

    if (pendingCount > 0 && !reachedLimit) {
      // Enqueue another batch
      await pool.enqueueAction(
        ctx,
        internal.scrapingActions.batchScrape,
        { crawlJobId: job._id },
        {
          context: { jobId: job._id },
          onComplete: internal.scraping.onBatchComplete,
        },
      );
    } else {
      // Job complete
      await ctx.db.patch(job._id, {
        status: "completed",
        completedAt: Date.now(),
      });
    }
  },
});
