import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import { Workpool, WorkId, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "./lib/auth";
import { Id } from "./_generated/dataModel";

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

// ─── Shared Types ───

type JobStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "canceling" | "canceled";

// ─── Shared onComplete Counter Logic (S3) ───

function applyResult(
  job: { processedItems: number; failedItems: number; skippedItems: number; failedItemDetails?: Array<{ itemKey: string; error: string }> },
  result: RunResult,
  itemKey: string,
) {
  const processedItems = job.processedItems + (result.kind === "success" ? 1 : 0);
  const failedItems = job.failedItems + (result.kind === "failed" ? 1 : 0);
  const skippedItems = job.skippedItems + (result.kind === "canceled" ? 1 : 0);
  const failedItemDetails = [...(job.failedItemDetails ?? [])];

  if (result.kind === "failed") {
    failedItemDetails.push({ itemKey, error: result.error });
  }

  return { processedItems, failedItems, skippedItems, failedItemDetails };
}

function counterPatch(counters: { processedItems: number; failedItems: number; skippedItems: number; failedItemDetails: Array<{ itemKey: string; error: string }> }) {
  return {
    processedItems: counters.processedItems,
    failedItems: counters.failedItems,
    skippedItems: counters.skippedItems,
    failedItemDetails: counters.failedItemDetails.length > 0 ? counters.failedItemDetails : undefined,
  };
}

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

    // Determine total items based on strategy
    const isPerDoc = args.strategy === "simple";
    const totalItems = isPerDoc ? docs.length : 1;

    // Create generation job record
    const jobId = await ctx.db.insert("generationJobs", {
      orgId,
      kbId: args.kbId,
      datasetId,
      strategy: args.strategy,
      status: "running",
      phase: "generating",
      totalItems,
      processedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Enqueue work items based on strategy and collect workIds (C1)
    const workIds: WorkId[] = [];

    if (isPerDoc) {
      for (const doc of docs) {
        const wId = await pool.enqueueAction(
          ctx,
          internal.generationActions.generateForDocument,
          {
            datasetId,
            documentId: doc._id,
            strategyConfig: args.strategyConfig,
          },
          {
            context: { jobId, itemKey: doc._id as string },
            onComplete: internal.generation.onQuestionGenerated,
          },
        );
        workIds.push(wId);
      }
    } else if (args.strategy === "dimension-driven") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generationActions.generateDimensionDriven,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else if (args.strategy === "real-world-grounded") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generationActions.generateRealWorldGrounded,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else {
      throw new Error(`Unknown strategy: ${args.strategy}`);
    }

    // Store workIds on the job for selective cancellation (C1)
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
    // I9: Guard against stale Phase 1 callbacks after Phase 2 has started
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

      // I1: Preserve Phase 1 stats before resetting counters
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

      // Enqueue one GT action per question and collect workIds (C1)
      const gtWorkIds: WorkId[] = [];
      for (const question of questions) {
        const wId = await pool.enqueueAction(
          ctx,
          internal.generationActions.assignGroundTruthForQuestion,
          {
            questionId: question._id,
            kbId: job.kbId,
            datasetId: job.datasetId,
          },
          {
            context: { jobId: context.jobId, itemKey: question._id as string },
            onComplete: internal.generation.onGroundTruthAssigned,
          },
        );
        gtWorkIds.push(wId);
      }

      // Update workIds for Phase 2 selective cancellation (C1)
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

      // I1: Consider Phase 1 failures in final status determination
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
        internal.langsmithSync.syncDataset,
        { datasetId: job.datasetId },
      );
    } else {
      await ctx.db.patch(context.jobId, counterPatch(counters));
    }
  },
});

// ─── Cancel Generation (C1: selective cancel, I3: status before cancel) ───

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

    // I3: Set status first so callbacks see "canceling"
    await ctx.db.patch(args.jobId, { status: "canceling" });

    // C1: Cancel only this job's work items, not the entire pool
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
