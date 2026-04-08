import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getAuthContext } from "../lib/auth";

// ─── Config Queries ───

export const configsByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    return await ctx.db
      .query("evaluatorConfigs")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

export const configsByKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId)
      throw new Error("Knowledge base not found");

    // Find all experiments for this KB
    const experiments = await ctx.db
      .query("experiments")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect();

    // Collect configs from all those experiments
    const allConfigs = [];
    for (const exp of experiments) {
      const configs = await ctx.db
        .query("evaluatorConfigs")
        .withIndex("by_experiment", (q) => q.eq("experimentId", exp._id))
        .collect();

      // Resolve failure mode and experiment names for display
      for (const c of configs) {
        const fm = await ctx.db.get(c.failureModeId);
        allConfigs.push({
          ...c,
          experimentName: exp.name,
          failureModeName: fm?.name ?? "Unknown",
          failureModeDescription: fm?.description ?? "",
        });
      }
    }

    return allConfigs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getConfig = query({
  args: { id: v.id("evaluatorConfigs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.id);
    if (!config || config.orgId !== orgId) return null;
    return config;
  },
});

export const getConfigInternal = internalQuery({
  args: { id: v.id("evaluatorConfigs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── Run Queries ───

export const runsByConfig = query({
  args: { evaluatorConfigId: v.id("evaluatorConfigs") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.evaluatorConfigId);
    if (!config || config.orgId !== orgId) return [];

    const runs = await ctx.db
      .query("evaluatorRuns")
      .withIndex("by_evaluator_config", (q) =>
        q.eq("evaluatorConfigId", args.evaluatorConfigId),
      )
      .collect();

    return runs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getRun = query({
  args: { id: v.id("evaluatorRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const run = await ctx.db.get(args.id);
    if (!run || run.orgId !== orgId) return null;
    return run;
  },
});

export const getRunInternal = internalQuery({
  args: { id: v.id("evaluatorRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── Result Queries ───

export const resultsByRun = query({
  args: { runId: v.id("evaluatorRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== orgId) return [];

    return await ctx.db
      .query("evaluatorResults")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const resultsByRunInternal = internalQuery({
  args: { runId: v.id("evaluatorRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evaluatorResults")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

// ─── Config Mutations ───

export const createConfig = mutation({
  args: {
    experimentId: v.id("experiments"),
    failureModeId: v.id("failureModes"),
    judgePrompt: v.string(),
    fewShotExampleIds: v.array(v.id("questions")),
    modelId: v.string(),
    splitConfig: v.optional(
      v.object({
        trainPct: v.number(),
        devPct: v.number(),
        testPct: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    const failureMode = await ctx.db.get(args.failureModeId);
    if (!failureMode || failureMode.orgId !== orgId)
      throw new Error("Failure mode not found");

    // Check if config already exists for this failure mode
    const existing = await ctx.db
      .query("evaluatorConfigs")
      .withIndex("by_failure_mode", (q) =>
        q.eq("failureModeId", args.failureModeId),
      )
      .collect();
    if (existing.length > 0) {
      throw new Error("Evaluator config already exists for this failure mode");
    }

    return await ctx.db.insert("evaluatorConfigs", {
      orgId,
      experimentId: args.experimentId,
      failureModeId: args.failureModeId,
      name: failureMode.name,
      judgePrompt: args.judgePrompt,
      fewShotExampleIds: args.fewShotExampleIds,
      modelId: args.modelId,
      splitConfig: args.splitConfig ?? {
        trainPct: 15,
        devPct: 43,
        testPct: 42,
      },
      splitSeed: Math.floor(Math.random() * 2147483647),
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const updateConfig = mutation({
  args: {
    id: v.id("evaluatorConfigs"),
    judgePrompt: v.optional(v.string()),
    fewShotExampleIds: v.optional(v.array(v.id("questions"))),
    modelId: v.optional(v.string()),
    splitConfig: v.optional(
      v.object({
        trainPct: v.number(),
        devPct: v.number(),
        testPct: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.id);
    if (!config || config.orgId !== orgId)
      throw new Error("Config not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.judgePrompt !== undefined) patch.judgePrompt = args.judgePrompt;
    if (args.fewShotExampleIds !== undefined)
      patch.fewShotExampleIds = args.fewShotExampleIds;
    if (args.modelId !== undefined) patch.modelId = args.modelId;
    if (args.splitConfig !== undefined) {
      patch.splitConfig = args.splitConfig;
      // Reset seed when split changes so data is re-shuffled
      patch.splitSeed = Math.floor(Math.random() * 2147483647);
    }

    // Reset metrics if prompt or examples changed (need re-validation)
    if (args.judgePrompt !== undefined || args.fewShotExampleIds !== undefined) {
      patch.devMetrics = undefined;
      patch.testMetrics = undefined;
      patch.status = "draft";
    }

    await ctx.db.patch(args.id, patch);
  },
});

// ─── Run Mutations ───

export const startValidation = mutation({
  args: {
    evaluatorConfigId: v.id("evaluatorConfigs"),
    runType: v.union(v.literal("dev"), v.literal("test")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.evaluatorConfigId);
    if (!config || config.orgId !== orgId)
      throw new Error("Config not found");

    // For test runs, require dev metrics first
    if (args.runType === "test" && !config.devMetrics) {
      throw new Error("Run validation on dev set first");
    }

    const runId = await ctx.db.insert("evaluatorRuns", {
      orgId,
      evaluatorConfigId: args.evaluatorConfigId,
      targetExperimentId: config.experimentId,
      runType: args.runType,
      status: "pending",
      totalTraces: 0,
      processedTraces: 0,
      failedTraces: 0,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.evaluator.actions.runValidation,
      {
        configId: args.evaluatorConfigId,
        runId,
        runType: args.runType,
      },
    );

    return runId;
  },
});

export const startFullRun = mutation({
  args: {
    evaluatorConfigId: v.id("evaluatorConfigs"),
    targetExperimentId: v.id("experiments"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.evaluatorConfigId);
    if (!config || config.orgId !== orgId)
      throw new Error("Config not found");

    if (!config.testMetrics) {
      throw new Error("Validate on test set before running on experiments");
    }

    const targetExp = await ctx.db.get(args.targetExperimentId);
    if (!targetExp || targetExp.orgId !== orgId)
      throw new Error("Target experiment not found");

    const runId = await ctx.db.insert("evaluatorRuns", {
      orgId,
      evaluatorConfigId: args.evaluatorConfigId,
      targetExperimentId: args.targetExperimentId,
      runType: "full",
      status: "pending",
      totalTraces: 0,
      processedTraces: 0,
      failedTraces: 0,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.evaluator.actions.runOnExperiment,
      {
        configId: args.evaluatorConfigId,
        runId,
        targetExperimentId: args.targetExperimentId,
      },
    );

    return runId;
  },
});

// ─── Internal Mutations (for use by actions) ───

export const updateRunStatusInternal = internalMutation({
  args: {
    runId: v.id("evaluatorRuns"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalTraces: v.optional(v.number()),
    processedTraces: v.optional(v.number()),
    failedTraces: v.optional(v.number()),
    rawPassRate: v.optional(v.number()),
    correctedPassRate: v.optional(v.number()),
    confidenceInterval: v.optional(
      v.object({ lower: v.number(), upper: v.number() }),
    ),
    tprUsed: v.optional(v.number()),
    tnrUsed: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runId, ...patch } = args;
    const updates: Record<string, unknown> = { ...patch };
    if (patch.status === "completed" || patch.status === "failed") {
      updates.completedAt = Date.now();
    }
    await ctx.db.patch(runId, updates);
  },
});

export const updateRunProgressInternal = internalMutation({
  args: {
    runId: v.id("evaluatorRuns"),
    processedTraces: v.number(),
    failedTraces: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      processedTraces: args.processedTraces,
      failedTraces: args.failedTraces,
    });
  },
});

export const insertResultInternal = internalMutation({
  args: {
    orgId: v.string(),
    runId: v.id("evaluatorRuns"),
    questionId: v.id("questions"),
    resultId: v.id("agentExperimentResults"),
    judgeVerdict: v.union(v.literal("pass"), v.literal("fail")),
    judgeReasoning: v.string(),
    humanLabel: v.optional(v.union(v.literal("pass"), v.literal("fail"))),
    agreesWithHuman: v.optional(v.boolean()),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
    ),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("evaluatorResults", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const createConfigInternal = internalMutation({
  args: {
    orgId: v.string(),
    experimentId: v.id("experiments"),
    failureModeId: v.id("failureModes"),
    name: v.string(),
    judgePrompt: v.string(),
    fewShotExampleIds: v.array(v.id("questions")),
    modelId: v.string(),
    splitConfig: v.object({
      trainPct: v.number(),
      devPct: v.number(),
      testPct: v.number(),
    }),
    splitSeed: v.number(),
  },
  handler: async (ctx, args) => {
    // Resolve failure mode name
    const fm = await ctx.db.get(args.failureModeId);
    return await ctx.db.insert("evaluatorConfigs", {
      orgId: args.orgId,
      experimentId: args.experimentId,
      failureModeId: args.failureModeId,
      name: fm?.name ?? args.name,
      judgePrompt: args.judgePrompt,
      fewShotExampleIds: args.fewShotExampleIds,
      modelId: args.modelId,
      splitConfig: args.splitConfig,
      splitSeed: args.splitSeed,
      status: "draft" as const,
      createdAt: Date.now(),
    });
  },
});

export const runsByConfigInternal = internalQuery({
  args: { evaluatorConfigId: v.id("evaluatorConfigs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evaluatorRuns")
      .withIndex("by_evaluator_config", (q) =>
        q.eq("evaluatorConfigId", args.evaluatorConfigId),
      )
      .collect();
  },
});

export const updateConfigMetricsInternal = internalMutation({
  args: {
    configId: v.id("evaluatorConfigs"),
    metricsType: v.union(v.literal("dev"), v.literal("test")),
    metrics: v.object({
      tpr: v.number(),
      tnr: v.number(),
      accuracy: v.number(),
      total: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.metricsType === "dev") {
      patch.devMetrics = args.metrics;
      patch.status = "validating";
    } else {
      patch.testMetrics = args.metrics;
      // Auto-set to "ready" if TPR/TNR >= 80%, otherwise "validated"
      patch.status =
        args.metrics.tpr >= 0.8 && args.metrics.tnr >= 0.8
          ? "ready"
          : "validated";
    }

    await ctx.db.patch(args.configId, patch);
  },
});
