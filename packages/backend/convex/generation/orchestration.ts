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
import { applyResult, counterPatch } from "../lib/workpool";
import { Id } from "../_generated/dataModel";
import type { JobStatus } from "rag-evaluation-system/shared";

// ─── WorkPool Instance ───

const pool = new Workpool(components.generationPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// ─── Start Generation ───

export const startGeneration = mutation({
  args: {
    kbId: v.id("knowledgeBases"),
    name: v.string(),
    strategy: v.string(),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    // ── Concurrent generation guard ──
    // Only one active generation per org at a time
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    const existingRunning = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .first();
    const existingPending = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .first();

    const existingActive = existingRunning ?? existingPending;
    if (existingActive && Date.now() - existingActive.createdAt <= TWO_HOURS) {
      const activeKb = await ctx.db.get(existingActive.kbId);
      const kbName = activeKb?.name ?? "unknown";
      throw new Error(
        `A generation job is already in progress (${existingActive.strategy} on "${kbName}"). ` +
        `Wait for it to complete or cancel it before starting a new one.`,
      );
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    // Create dataset record
    const datasetId = await ctx.db.insert("datasets", {
      orgId,
      kbId: args.kbId,
      name: args.name,
      strategy: args.strategy,
      strategyConfig: args.strategyConfig,
      questionCount: 0,
      metadata: {},
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Get documents for this KB
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect();

    if (docs.length === 0) {
      throw new Error("No documents in knowledge base to generate questions from");
    }

    // Unified strategy uses two-phase WorkPool; others are single-action
    const isUnified = args.strategy === "unified";
    const totalItems = 1;

    // Create generation job record
    const jobId = await ctx.db.insert("generationJobs", {
      orgId,
      kbId: args.kbId,
      datasetId,
      strategy: args.strategy,
      status: "running",
      phase: isUnified ? "preparing" : "generating",
      totalItems,
      processedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Enqueue work items based on strategy and collect workIds for selective cancellation
    const workIds: WorkId[] = [];

    if (args.strategy === "simple") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.generateSimple,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.orchestration.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else if (args.strategy === "dimension-driven") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.generateDimensionDriven,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.orchestration.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else if (args.strategy === "real-world-grounded") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.generateRealWorldGrounded,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.orchestration.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else if (args.strategy === "unified") {
      // Phase 1: preparation (single action that calls savePlanAndEnqueueDocs internally)
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.prepareGeneration,
        {
          jobId,
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "prepare" },
          onComplete: internal.generation.orchestration.onPrepareComplete,
        },
      );
      workIds.push(wId);
    } else {
      throw new Error(`Unknown strategy: ${args.strategy}`);
    }

    // Store workIds on the job for selective cancellation
    await ctx.db.patch(jobId, { workIds: workIds as string[] });

    return { datasetId, jobId };
  },
});

// ─── Phase 1 onComplete: onQuestionGenerated ───

export const onQuestionGenerated = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("generationJobs"),
      itemKey: v.string(),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"generationJobs">; itemKey: string };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;
    if (job.status === "canceled") return;
    // Guard against stale Phase 1 callbacks arriving after Phase 2 has started
    if (job.phase === "ground-truth") return;

    const counters = applyResult(job, result, context.itemKey);
    const totalHandled = counters.processedItems + counters.failedItems + counters.skippedItems;
    const isComplete = totalHandled >= job.totalItems;

    if (isComplete) {
      if (job.status === "canceling") {
        await ctx.db.patch(context.jobId, {
          ...counterPatch(counters),
          status: "canceled" as JobStatus,
          completedAt: Date.now(),
        });
        return;
      }

      // Query all generated questions for this dataset
      const questions = await ctx.db
        .query("questions")
        .withIndex("by_dataset", (q) => q.eq("datasetId", job.datasetId))
        .collect();

      if (questions.length === 0) {
        const status: JobStatus = counters.failedItems > 0 ? "failed" : "completed";
        await ctx.db.patch(context.jobId, {
          ...counterPatch(counters),
          status,
          completedAt: Date.now(),
        });
        return;
      }

      // Preserve Phase 1 stats before resetting counters for Phase 2
      await ctx.db.patch(context.jobId, {
        phase1Stats: {
          processedItems: counters.processedItems,
          failedItems: counters.failedItems,
          skippedItems: counters.skippedItems,
        },
        phase: "ground-truth",
        totalItems: questions.length,
        processedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        failedItemDetails: undefined,
      });

      // Enqueue one ground-truth action per question and collect workIds
      const gtWorkIds: WorkId[] = [];
      for (const question of questions) {
        const wId = await pool.enqueueAction(
          ctx,
          internal.generation.actions.assignGroundTruthForQuestion,
          {
            questionId: question._id,
            kbId: job.kbId,
            datasetId: job.datasetId,
          },
          {
            context: { jobId: context.jobId, itemKey: question._id as string },
            onComplete: internal.generation.orchestration.onGroundTruthAssigned,
          },
        );
        gtWorkIds.push(wId);
      }

      // Update workIds for Phase 2 selective cancellation
      await ctx.db.patch(context.jobId, { workIds: gtWorkIds as string[] });
    } else {
      await ctx.db.patch(context.jobId, counterPatch(counters));
    }
  },
});

// ─── Phase 2 onComplete: onGroundTruthAssigned ───

export const onGroundTruthAssigned = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("generationJobs"),
      itemKey: v.string(),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"generationJobs">; itemKey: string };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;
    if (job.status === "canceled") return;

    const counters = applyResult(job, result, context.itemKey);
    const totalHandled = counters.processedItems + counters.failedItems + counters.skippedItems;
    const isComplete = totalHandled >= job.totalItems;

    if (isComplete) {
      if (job.status === "canceling") {
        await ctx.db.patch(context.jobId, {
          ...counterPatch(counters),
          status: "canceled" as JobStatus,
          completedAt: Date.now(),
        });
        return;
      }

      // Finalize: update dataset question count
      const questions = await ctx.db
        .query("questions")
        .withIndex("by_dataset", (q) => q.eq("datasetId", job.datasetId))
        .collect();

      await ctx.db.patch(job.datasetId, {
        questionCount: questions.length,
      });

      // Consider Phase 1 failures when determining final job status
      const phase1Failures = job.phase1Stats?.failedItems ?? 0;
      const totalFailures = counters.failedItems + phase1Failures;

      let status: JobStatus;
      if (totalFailures === 0) {
        status = "completed";
      } else if (counters.failedItems === job.totalItems) {
        status = "failed";
      } else {
        status = "completed_with_errors";
      }

      await ctx.db.patch(context.jobId, {
        ...counterPatch(counters),
        status,
        completedAt: Date.now(),
      });

      // Fire-and-forget LangSmith sync
      await ctx.scheduler.runAfter(
        0,
        internal.langsmith.sync.syncDataset,
        { datasetId: job.datasetId },
      );
    } else {
      await ctx.db.patch(context.jobId, counterPatch(counters));
    }
  },
});

// ─── Unified Pipeline: Phase 1 onComplete ───

export const onPrepareComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("generationJobs"),
      itemKey: v.string(),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"generationJobs">; itemKey: string };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;
    if (job.status === "canceled") return;

    // Only handle failure here — success is handled by savePlanAndEnqueueDocs
    if (result.kind !== "success") {
      const counters = applyResult(job, result, context.itemKey);
      await ctx.db.patch(context.jobId, {
        ...counterPatch(counters),
        status: (result.kind === "canceled" ? "canceled" : "failed") as JobStatus,
        completedAt: Date.now(),
        error: result.kind === "failed" ? result.error : "Preparation canceled",
      });
    }
    // If success: savePlanAndEnqueueDocs already enqueued Phase 2 work
  },
});

// ─── Unified Pipeline: savePlanAndEnqueueDocs ───

export const savePlanAndEnqueueDocs = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
    plan: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    if (job.status === "canceled" || job.status === "canceling") return;

    const plan = args.plan as {
      quotas: Record<string, number>;
      unmatchedQuestions: string[];
      validCombos: Record<string, string>[];
      globalStyleExamples: string[];
      docPlans: Array<{
        docConvexId: string;
        docId: string;
        title: string;
        quota: number;
        matchedQuestions: any[];
      }>;
      preferences: any;
      model: string;
    };

    // Filter to docs with quota > 0
    const activeDocs = plan.docPlans.filter(d => d.quota > 0);

    // Update job with Phase 2 tracking
    await ctx.db.patch(args.jobId, {
      phase: "generating",
      totalItems: activeDocs.length,
      processedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      totalDocs: activeDocs.length,
      docsProcessed: 0,
    });

    // Store unmatched questions on dataset metadata (knowledge gaps)
    if (plan.unmatchedQuestions.length > 0) {
      const dataset = await ctx.db.get(args.datasetId);
      if (dataset) {
        const existing = (dataset.metadata ?? {}) as Record<string, any>;
        await ctx.db.patch(args.datasetId, {
          metadata: { ...existing, knowledgeGaps: plan.unmatchedQuestions },
        });
      }
    }

    // Enqueue one generateForDoc action per document
    const workIds: WorkId[] = [];
    for (const doc of activeDocs) {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.generateForDoc,
        {
          jobId: args.jobId,
          datasetId: args.datasetId,
          docConvexId: doc.docConvexId as Id<"documents">,
          docId: doc.docId,
          quota: doc.quota,
          matchedQuestions: doc.matchedQuestions,
          validCombos: plan.validCombos,
          preferences: plan.preferences,
          globalStyleExamples: plan.globalStyleExamples,
          model: plan.model,
        },
        {
          context: { jobId: args.jobId, itemKey: doc.docId },
          onComplete: internal.generation.orchestration.onDocGenerated,
        },
      );
      workIds.push(wId);
    }

    // Update workIds for selective cancellation
    await ctx.db.patch(args.jobId, { workIds: workIds as string[] });
  },
});

// ─── Unified Pipeline: Phase 2 onComplete (per-doc) ───

export const onDocGenerated = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      jobId: v.id("generationJobs"),
      itemKey: v.string(),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { jobId: Id<"generationJobs">; itemKey: string };
    result: RunResult;
  }) => {
    const job = await ctx.db.get(context.jobId);
    if (!job) return;
    if (job.status === "canceled") return;

    const counters = applyResult(job, result, context.itemKey);
    const totalHandled = counters.processedItems + counters.failedItems + counters.skippedItems;
    const isComplete = totalHandled >= job.totalItems;

    // Update docsProcessed
    const docsProcessed = (job.docsProcessed ?? 0) + 1;

    if (isComplete) {
      if (job.status === "canceling") {
        await ctx.db.patch(context.jobId, {
          ...counterPatch(counters),
          status: "canceled" as JobStatus,
          completedAt: Date.now(),
          docsProcessed,
        });
        return;
      }

      // Finalize: count total questions
      const questions = await ctx.db
        .query("questions")
        .withIndex("by_dataset", (q) => q.eq("datasetId", job.datasetId))
        .collect();

      await ctx.db.patch(job.datasetId, {
        questionCount: questions.length,
      });

      let status: JobStatus;
      if (counters.failedItems === 0) {
        status = "completed";
      } else if (counters.failedItems === job.totalItems) {
        status = "failed";
      } else {
        status = "completed_with_errors";
      }

      await ctx.db.patch(context.jobId, {
        ...counterPatch(counters),
        status,
        completedAt: Date.now(),
        docsProcessed,
      });

      // Fire-and-forget LangSmith sync
      await ctx.scheduler.runAfter(
        0,
        internal.langsmith.sync.syncDataset,
        { datasetId: job.datasetId },
      );
    } else {
      await ctx.db.patch(context.jobId, {
        ...counterPatch(counters),
        docsProcessed,
      });
    }
  },
});

// ─── Unified Pipeline: Progress Update ───

export const updateDocProgress = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    docName: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;
    await ctx.db.patch(args.jobId, {
      currentDocName: args.docName,
    });
  },
});

// ─── Cancel Generation ───

export const cancelGeneration = mutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) {
      throw new Error("Generation job not found");
    }
    if (job.status !== "running" && job.status !== "pending") {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }

    // Set status to "canceling" first so in-flight callbacks see the updated state
    await ctx.db.patch(args.jobId, { status: "canceling" });

    // Cancel only this job's work items, not the entire pool
    const workIds = job.workIds ?? [];
    for (const wId of workIds) {
      await pool.cancel(ctx, wId as WorkId);
    }
  },
});

// ─── Queries ───

export const getJob = query({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== orgId) return null;

    const pendingItems = job.totalItems - job.processedItems - job.failedItems - job.skippedItems;
    return { ...job, pendingItems };
  },
});

export const listJobs = query({
  args: {
    kbId: v.optional(v.id("knowledgeBases")),
    datasetId: v.optional(v.id("datasets")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    if (args.datasetId) {
      const jobs = await ctx.db
        .query("generationJobs")
        .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId!))
        .order("desc")
        .collect();
      return jobs.filter((j) => j.orgId === orgId);
    }

    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    if (args.kbId) {
      return jobs.filter((j) => j.kbId === args.kbId);
    }
    return jobs;
  },
});

export const getJobInternal = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/**
 * Return the most recent active (running/pending) generation job for this org.
 * Filters out stale jobs (>2 hours old) to prevent permanent blocking.
 * If kbId is provided, only returns active jobs for that KB.
 */
export const getActiveJob = query({
  args: { kbId: v.optional(v.id("knowledgeBases")) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const running = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .collect();
    const pending = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect();

    const active = [...running, ...pending];

    // Filter out stale jobs (>2 hours old)
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const healthy = active.filter((j) => Date.now() - j.createdAt <= TWO_HOURS);

    // If kbId specified, filter to that KB
    const filtered = args.kbId
      ? healthy.filter((j) => j.kbId === args.kbId)
      : healthy;

    if (filtered.length === 0) return null;

    // Return the most recent active job
    const job = filtered.sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      ...job,
      pendingItems: job.totalItems - job.processedItems - job.failedItems - job.skippedItems,
    };
  },
});
