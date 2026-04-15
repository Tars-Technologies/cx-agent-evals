import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { Workpool, WorkId, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "../lib/auth";
import { Id } from "../_generated/dataModel";

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
      kbId: dataset.kbId,
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
      internal.experiments.actions.runExperiment,
      {
        experimentId,
        datasetId: args.datasetId,
        kbId: dataset.kbId,
      },
    );

    return { experimentId };
  },
});

// ─── Agent Experiment WorkPool ───

const agentPool = new Workpool(components.agentExperimentPool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

// ─── Start Agent Experiment ───

export const startAgentExperiment = mutation({
  args: {
    datasetId: v.id("datasets"),
    agentId: v.id("agents"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    if (agent.status !== "ready") {
      throw new Error(
        `Agent is not ready (status: ${agent.status}). Configure and save the agent first.`,
      );
    }

    // Verify at least one agent retriever is on the dataset's KB and ready
    let hasValidRetriever = false;
    for (const retrieverId of agent.retrieverIds) {
      const retriever = await ctx.db.get(retrieverId);
      if (
        retriever &&
        retriever.kbId === dataset.kbId &&
        retriever.status === "ready"
      ) {
        hasValidRetriever = true;
        break;
      }
    }
    if (!hasValidRetriever) {
      throw new Error(
        "Agent has no ready retrievers on this dataset's knowledge base",
      );
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    const experimentId = await ctx.db.insert("experiments", {
      orgId,
      kbId: dataset.kbId,
      datasetId: args.datasetId,
      name: args.name,
      experimentType: "agent",
      agentId: args.agentId,
      metricNames: ["recall", "precision", "iou", "f1"],
      status: "pending",
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Schedule setup action (loads questions + enqueues per-question items)
    await ctx.scheduler.runAfter(
      0,
      internal.experiments.agentActions.runAgentExperimentSetup,
      {
        experimentId,
        datasetId: args.datasetId,
        kbId: dataset.kbId,
      },
    );

    return { experimentId };
  },
});

// ─── Enqueue Agent Questions (called by setup action) ───

export const enqueueAgentQuestions = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    questionIds: v.array(v.id("questions")),
    agentId: v.id("agents"),
    kbId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    const workIds: string[] = [];

    for (const questionId of args.questionIds) {
      const wId = await agentPool.enqueueAction(
        ctx,
        internal.experiments.agentActions.evaluateAgentQuestion,
        {
          experimentId: args.experimentId,
          questionId,
          agentId: args.agentId,
          kbId: args.kbId,
        },
        {
          context: {
            experimentId: args.experimentId,
            itemKey: questionId as string,
          },
          onComplete:
            internal.experiments.orchestration.onAgentQuestionComplete,
        },
      );
      workIds.push(wId as string);
    }

    await ctx.db.patch(args.experimentId, { workIds });
  },
});

// ─── onComplete: onAgentQuestionComplete ───

export const onAgentQuestionComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      experimentId: v.id("experiments"),
      itemKey: v.string(),
    }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { experimentId: Id<"experiments">; itemKey: string };
      result: RunResult;
    },
  ) => {
    const experiment = await ctx.db.get(context.experimentId);
    if (!experiment) return;
    if (experiment.status === "canceled") return;

    // Increment counters
    const processed =
      (experiment.processedQuestions ?? 0) +
      (result.kind === "success" ? 1 : 0);
    const failed =
      (experiment.failedQuestions ?? 0) +
      (result.kind === "failed" ? 1 : 0);
    const skipped =
      (experiment.skippedQuestions ?? 0) +
      (result.kind === "canceled" ? 1 : 0);
    const totalHandled = processed + failed + skipped;
    const isComplete = totalHandled >= (experiment.totalQuestions ?? 0);

    if (experiment.status === "canceling" && isComplete) {
      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped,
        status: "canceled",
        completedAt: Date.now(),
      });
      return;
    }

    if (isComplete) {
      // Aggregate scores from all completed results
      const results = await ctx.db
        .query("agentExperimentResults")
        .withIndex("by_experiment", (q) =>
          q.eq("experimentId", context.experimentId),
        )
        .collect();

      const metricNames = ["recall", "precision", "iou", "f1"];
      const avgScores: Record<string, number> = {};
      for (const name of metricNames) {
        const values = results
          .filter(
            (r) =>
              r.status === "complete" && r.scores != null,
          )
          .map((r) => (r.scores as Record<string, number>)[name])
          .filter((v): v is number => typeof v === "number");
        avgScores[name] =
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0;
      }

      const status =
        failed > 0 && processed === 0
          ? ("failed" as const)
          : failed > 0
            ? ("completed_with_errors" as const)
            : ("completed" as const);

      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped,
        status,
        scores: avgScores,
        phase: "done",
        completedAt: Date.now(),
      });
    } else {
      // Progress update
      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped,
      });
    }
  },
});

// ─── Cancel Agent Experiment ───

export const cancelAgentExperiment = mutation({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const experiment = await ctx.db.get(args.experimentId);
    if (!experiment || experiment.orgId !== orgId) {
      throw new Error("Experiment not found");
    }
    if (experiment.status !== "running" && experiment.status !== "pending") {
      throw new Error(
        `Cannot cancel experiment in status: ${experiment.status}`,
      );
    }

    await ctx.db.patch(args.experimentId, { status: "canceling" });

    const workIds = experiment.workIds ?? [];
    for (const wId of workIds) {
      await agentPool.cancel(ctx, wId as WorkId);
    }
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
      // If part of a run, notify the parent.
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(0, internal.experimentRuns.orchestration.onChildComplete, {
          experimentRunId: experiment.experimentRunId,
          experimentId: context.experimentId,
          success: true,
        });
      }
      return;
    }

    if (result.kind === "canceled") {
      await ctx.db.patch(context.experimentId, {
        status: "canceled",
        completedAt: Date.now(),
      });
      // Notify parent run (count as failed)
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(0, internal.experimentRuns.orchestration.onChildComplete, {
          experimentRunId: experiment.experimentRunId,
          experimentId: context.experimentId,
          success: false,
        });
      }
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
    // Notify parent run
    if (experiment.experimentRunId) {
      await ctx.runMutation(internal.experimentRuns.orchestration.onChildComplete, {
        experimentRunId: experiment.experimentRunId,
        experimentId: context.experimentId,
        success: false,
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
      internal.experiments.actions.runEvaluation,
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
        onComplete: internal.experiments.orchestration.onExperimentComplete,
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
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    scores: v.optional(v.record(v.string(), v.number())),
    error: v.optional(v.string()),
    phase: v.optional(
      v.union(
        v.literal("initializing"),
        v.literal("indexing"),
        v.literal("syncing"),
        v.literal("evaluating"),
        v.literal("done"),
      ),
    ),
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

export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    return await ctx.db
      .query("experiments")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const exp = await ctx.db.get(args.id);
    // Return null instead of throwing — query is used by useQuery which
    // may call with a stale/deleted experiment ID
    if (!exp || exp.orgId !== orgId) return null;
    return exp;
  },
});
