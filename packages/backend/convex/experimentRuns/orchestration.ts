import { mutation, query, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { Id } from "../_generated/dataModel";

// ─── Create Experiment Run ───

export const create = mutation({
  args: {
    name: v.string(),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
    retrieverIds: v.array(v.id("retrievers")),
    metricNames: v.array(v.string()),
    scoringWeights: v.object({
      recall: v.number(),
      precision: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Validate KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found");

    // Validate dataset belongs to KB and org
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) throw new Error("Dataset not found");
    if (dataset.kbId !== args.kbId) throw new Error("Dataset does not belong to this KB");

    // Validate weights sum to ~1.0
    const weightSum = args.scoringWeights.recall + args.scoringWeights.precision;
    if (Math.abs(weightSum - 1.0) > 0.01) throw new Error("Scoring weights must sum to 1.0");

    // Validate all retrievers exist, belong to org/KB, and are ready
    for (const retrieverId of args.retrieverIds) {
      const retriever = await ctx.db.get(retrieverId);
      if (!retriever || retriever.orgId !== orgId) throw new Error(`Retriever not found: ${retrieverId}`);
      if (retriever.kbId !== args.kbId) throw new Error(`Retriever ${retriever.name} does not belong to this KB`);
      if (retriever.status !== "ready") throw new Error(`Retriever ${retriever.name} is not ready (status: ${retriever.status})`);
    }

    // Look up user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    // Create parent run
    const runId = await ctx.db.insert("experimentRuns", {
      orgId,
      kbId: args.kbId,
      datasetId: args.datasetId,
      name: args.name,
      retrieverIds: args.retrieverIds,
      metricNames: args.metricNames,
      scoringWeights: args.scoringWeights,
      status: "pending",
      totalRetrievers: args.retrieverIds.length,
      completedRetrievers: 0,
      failedRetrievers: 0,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Create child experiments and schedule evaluation for each
    for (const retrieverId of args.retrieverIds) {
      const experimentId = await ctx.db.insert("experiments", {
        orgId,
        kbId: args.kbId,
        datasetId: args.datasetId,
        name: `${args.name} — ${(await ctx.db.get(retrieverId))?.name ?? "retriever"}`,
        experimentRunId: runId,
        retrieverId,
        metricNames: args.metricNames,
        status: "pending",
        createdBy: user._id,
        createdAt: Date.now(),
      });

      // Schedule the full existing pipeline for this child
      await ctx.scheduler.runAfter(
        0,
        internal.experiments.actions.runExperiment,
        {
          experimentId,
          datasetId: args.datasetId,
          kbId: args.kbId,
        },
      );
    }

    // Mark run as running
    await ctx.db.patch(runId, { status: "running" });

    return { runId };
  },
});

// ─── List Runs by KB ───

export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found");

    return await ctx.db
      .query("experimentRuns")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});

// ─── Get Single Run ───

export const get = query({
  args: { id: v.id("experimentRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const run = await ctx.db.get(args.id);
    if (!run || run.orgId !== orgId) return null;
    return run;
  },
});

// ─── Get Run with Ranked Scores ───

export const getWithScores = query({
  args: { id: v.id("experimentRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const run = await ctx.db.get(args.id);
    if (!run || run.orgId !== orgId) return null;

    // Fetch child experiments
    const children = await ctx.db
      .query("experiments")
      .withIndex("by_run", (q) => q.eq("experimentRunId", args.id))
      .collect();

    // Build ranked results
    const results = await Promise.all(
      children.map(async (exp) => {
        const retriever = exp.retrieverId ? await ctx.db.get(exp.retrieverId) : null;
        const scores = (exp.scores ?? {}) as Record<string, number>;
        const recall = scores.recall ?? 0;
        const precision = scores.precision ?? 0;
        const compositeScore = run.scoringWeights.recall * recall + run.scoringWeights.precision * precision;

        return {
          experimentId: exp._id,
          retrieverId: exp.retrieverId,
          retrieverName: retriever?.name ?? "Unknown",
          status: exp.status,
          recall,
          precision,
          f1: scores.f1,
          iou: scores.iou,
          compositeScore,
        };
      }),
    );

    // Sort by composite score descending
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    // Fetch dataset for question count
    const dataset = await ctx.db.get(run.datasetId);

    return {
      ...run,
      questionCount: dataset?.questionCount ?? 0,
      datasetName: dataset?.name ?? "Unknown",
      rankedResults: results,
    };
  },
});

// ─── Internal: Child Experiment Completion Callback ───

export const onChildComplete = internalMutation({
  args: {
    experimentRunId: v.id("experimentRuns"),
    experimentId: v.id("experiments"),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.experimentRunId);
    if (!run) return;

    const completed = run.completedRetrievers + (args.success ? 1 : 0);
    const failed = run.failedRetrievers + (args.success ? 0 : 1);
    const totalHandled = completed + failed;
    const isComplete = totalHandled >= run.totalRetrievers;

    if (!isComplete) {
      await ctx.db.patch(args.experimentRunId, {
        completedRetrievers: completed,
        failedRetrievers: failed,
      });
      return;
    }

    // All children done — compute rankings
    const children = await ctx.db
      .query("experiments")
      .withIndex("by_run", (q) => q.eq("experimentRunId", args.experimentRunId))
      .collect();

    let bestId: Id<"retrievers"> | undefined;
    let bestName: string | undefined;
    let bestScore = -1;

    for (const exp of children) {
      if (exp.status !== "completed" && exp.status !== "completed_with_errors") continue;
      const scores = (exp.scores ?? {}) as Record<string, number>;
      const recall = scores.recall ?? 0;
      const precision = scores.precision ?? 0;
      const composite = run.scoringWeights.recall * recall + run.scoringWeights.precision * precision;

      if (composite > bestScore && exp.retrieverId) {
        bestScore = composite;
        bestId = exp.retrieverId;
        const retriever = await ctx.db.get(exp.retrieverId);
        bestName = retriever?.name;
      }
    }

    const finalStatus = failed > 0 && completed === 0
      ? "failed" as const
      : failed > 0
        ? "completed_with_errors" as const
        : "completed" as const;

    await ctx.db.patch(args.experimentRunId, {
      completedRetrievers: completed,
      failedRetrievers: failed,
      status: finalStatus,
      winnerId: bestId,
      winnerName: bestName,
      winnerScore: bestScore >= 0 ? bestScore : undefined,
      completedAt: Date.now(),
    });
  },
});
