import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import { Workpool, WorkId, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "./lib/auth";
import { Id } from "./_generated/dataModel";

// ─── WorkPool Instance ───

const pool = new Workpool(components.experimentPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// ─── Start Experiment ───

export const start = mutation({
  args: {
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverId: v.optional(v.id("retrievers")),
    retrieverConfig: v.optional(v.any()),
    k: v.optional(v.number()),
    metricNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    // Validate: must provide either retrieverId or retrieverConfig
    if (!args.retrieverId && !args.retrieverConfig) {
      throw new Error("Must provide either retrieverId or retrieverConfig");
    }

    // If using retrieverId, verify the retriever is ready and KB matches
    if (args.retrieverId) {
      const retriever = await ctx.db.get(args.retrieverId);
      if (!retriever || retriever.orgId !== orgId) {
        throw new Error("Retriever not found");
      }
      if (retriever.status !== "ready") {
        throw new Error(
          `Retriever is not ready (status: ${retriever.status}). Index the KB first.`,
        );
      }
      if (retriever.kbId !== dataset.kbId) {
        throw new Error(
          "Retriever and dataset must belong to the same knowledge base",
        );
      }
    }

    const experimentId = await ctx.db.insert("experiments", {
      orgId,
      datasetId: args.datasetId,
      name: args.name,
      retrieverId: args.retrieverId,
      retrieverConfig: args.retrieverConfig,
      k: args.k,
      metricNames: args.metricNames,
      status: "pending",
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Schedule the orchestrator action (no separate jobs record)
    await ctx.scheduler.runAfter(
      0,
      internal.experimentActions.runExperiment,
      {
        experimentId,
        datasetId: args.datasetId,
        kbId: dataset.kbId,
      },
    );

    return { experimentId };
  },
});

// ─── onComplete: onQuestionEvaluated ───

export const onQuestionEvaluated = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      experimentId: v.id("experiments"),
      questionId: v.id("questions"),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { experimentId: Id<"experiments">; questionId: Id<"questions"> };
    result: RunResult;
  }) => {
    const experiment = await ctx.db.get(context.experimentId);
    if (!experiment) return;
    if (experiment.status === "canceled") return;

    // I2/S3: Separate counters for success, failed, canceled (skipped)
    const processedQuestions = (experiment.processedQuestions ?? 0) + (result.kind === "success" ? 1 : 0);
    const failedQuestions = (experiment.failedQuestions ?? 0) + (result.kind === "failed" ? 1 : 0);
    const skippedQuestions = (experiment.skippedQuestions ?? 0) + (result.kind === "canceled" ? 1 : 0);

    // S1: Guard against undefined totalQuestions
    const totalQuestions = experiment.totalQuestions ?? 0;
    if (totalQuestions === 0) return;

    const totalHandled = processedQuestions + failedQuestions + skippedQuestions;
    const isComplete = totalHandled >= totalQuestions;

    if (isComplete) {
      if (experiment.status === "canceling") {
        await ctx.db.patch(context.experimentId, {
          processedQuestions,
          failedQuestions,
          skippedQuestions,
          status: "canceled",
          completedAt: Date.now(),
        });
        return;
      }

      // Aggregate scores
      const results = await ctx.db
        .query("experimentResults")
        .withIndex("by_experiment", (q) =>
          q.eq("experimentId", context.experimentId),
        )
        .collect();

      const metricNames = experiment.metricNames;
      const avgScores: Record<string, number> = {};

      for (const name of metricNames) {
        const values = results
          .map((r) => (r.scores as Record<string, number>)[name])
          .filter((v): v is number => typeof v === "number");

        avgScores[name] =
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0;
      }

      const status = failedQuestions === 0 ? "completed" : "completed_with_errors";

      await ctx.db.patch(context.experimentId, {
        processedQuestions,
        failedQuestions,
        skippedQuestions,
        status,
        scores: avgScores,
        phase: "done",
        completedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(context.experimentId, {
        processedQuestions,
        failedQuestions,
        skippedQuestions,
      });
    }
  },
});

// ─── Cancel Experiment ───

export const cancelExperiment = mutation({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const experiment = await ctx.db.get(args.experimentId);
    if (!experiment || experiment.orgId !== orgId) {
      throw new Error("Experiment not found");
    }
    if (experiment.status !== "running" && experiment.status !== "pending") {
      throw new Error(`Cannot cancel experiment in status: ${experiment.status}`);
    }

    // I3: Set status first so callbacks see "canceling"
    await ctx.db.patch(args.experimentId, { status: "canceling" });

    // C1: Cancel only this experiment's work items, not the entire pool
    const workIds = experiment.workIds ?? [];
    for (const wId of workIds) {
      await pool.cancel(ctx, wId as WorkId);
    }
  },
});

// ─── Enqueue Evaluations (must be in non-"use node" file) ───

export const enqueueEvaluations = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number(),
    langsmithExperimentId: v.optional(v.string()),
    questionIds: v.array(v.id("questions")),
  },
  handler: async (ctx, args) => {
    // C1: Collect workIds for selective cancellation
    const workIds: WorkId[] = [];
    for (const questionId of args.questionIds) {
      const wId = await pool.enqueueAction(
        ctx,
        internal.experimentActions.evaluateQuestion,
        {
          experimentId: args.experimentId,
          questionId,
          kbId: args.kbId,
          indexConfigHash: args.indexConfigHash,
          embeddingModel: args.embeddingModel,
          k: args.k,
          langsmithExperimentId: args.langsmithExperimentId,
        },
        {
          context: {
            experimentId: args.experimentId,
            questionId,
          },
          onComplete: internal.experiments.onQuestionEvaluated,
        },
      );
      workIds.push(wId);
    }

    // Store workIds on experiment for selective cancellation
    await ctx.db.patch(args.experimentId, { workIds: workIds as string[] });
  },
});

// ─── Internal Queries/Mutations ───

export const getInternal = internalQuery({
  args: { id: v.id("experiments") },
  handler: async (ctx, args) => {
    const exp = await ctx.db.get(args.id);
    if (!exp) throw new Error("Experiment not found");
    return exp;
  },
});

export const updateStatus = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    status: v.string(),
    scores: v.optional(v.any()),
    error: v.optional(v.string()),
    phase: v.optional(v.string()),
    totalQuestions: v.optional(v.number()),
    langsmithExperimentId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.scores !== undefined) patch.scores = args.scores;
    if (args.error !== undefined) patch.error = args.error;
    if (args.phase !== undefined) patch.phase = args.phase;
    if (args.totalQuestions !== undefined) patch.totalQuestions = args.totalQuestions;
    if (args.langsmithExperimentId !== undefined) patch.langsmithExperimentId = args.langsmithExperimentId;
    if (args.langsmithUrl !== undefined) patch.langsmithUrl = args.langsmithUrl;
    await ctx.db.patch(args.experimentId, patch);
  },
});

// ─── Public Queries ───

export const byDataset = query({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }

    return await ctx.db
      .query("experiments")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const exp = await ctx.db.get(args.id);
    // C3: Return null instead of throwing — query is used by useQuery which
    // may call with a stale/deleted experiment ID
    if (!exp || exp.orgId !== orgId) return null;
    return exp;
  },
});
