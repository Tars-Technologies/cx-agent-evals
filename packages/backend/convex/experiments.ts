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
  maxParallelism: 1,
  // Retry is disabled: evaluate() processes the full dataset sequentially.
  // If it times out, retrying from scratch won't help.
  retryActionsByDefault: false,
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

    // Schedule the orchestrator action
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

// ─── onComplete: onExperimentComplete ───

/**
 * Handles completion of the single evaluate() WorkPool item.
 * On success: experiment should already be marked complete by the action.
 * On failure: mark experiment as failed.
 * On cancel: mark experiment as canceled.
 */
export const onExperimentComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      experimentId: v.id("experiments"),
    }),
  ),
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { experimentId: Id<"experiments"> };
    result: RunResult;
  }) => {
    const experiment = await ctx.db.get(context.experimentId);
    if (!experiment) return;

    if (result.kind === "success") {
      // The action itself marks the experiment as completed with scores.
      // Nothing more to do here.
      return;
    }

    if (result.kind === "canceled") {
      await ctx.db.patch(context.experimentId, {
        status: "canceled",
        completedAt: Date.now(),
      });
      return;
    }

    // result.kind === "failed"
    if (experiment.status !== "failed") {
      await ctx.db.patch(context.experimentId, {
        status: "failed",
        error: result.error ?? "Evaluation action failed",
        completedAt: Date.now(),
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

    await ctx.db.patch(args.experimentId, { status: "canceling" });

    const workIds = experiment.workIds ?? [];
    for (const wId of workIds) {
      await pool.cancel(ctx, wId as WorkId);
    }
  },
});

// ─── Enqueue Experiment (single WorkPool item) ───

export const enqueueExperiment = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number(),
    datasetName: v.string(),
  },
  handler: async (ctx, args) => {
    const wId = await pool.enqueueAction(
      ctx,
      internal.experimentActions.runEvaluation,
      {
        experimentId: args.experimentId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        indexConfigHash: args.indexConfigHash,
        embeddingModel: args.embeddingModel,
        k: args.k,
        datasetName: args.datasetName,
      },
      {
        context: {
          experimentId: args.experimentId,
        },
        onComplete: internal.experiments.onExperimentComplete,
      },
    );

    await ctx.db.patch(args.experimentId, { workIds: [wId as string] });
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
    processedQuestions: v.optional(v.number()),
    langsmithExperimentId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.scores !== undefined) patch.scores = args.scores;
    if (args.error !== undefined) patch.error = args.error;
    if (args.phase !== undefined) patch.phase = args.phase;
    if (args.totalQuestions !== undefined) patch.totalQuestions = args.totalQuestions;
    if (args.processedQuestions !== undefined) patch.processedQuestions = args.processedQuestions;
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
