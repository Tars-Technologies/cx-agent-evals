import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getAuthContext } from "../lib/auth";
import { computeSplit, stratifiedFewShot } from "./splits";
import { toBinaryLabel } from "../lib/labels";

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

/**
 * Returns the train/dev/test split for a config, and the training-set
 * questions joined with their annotations and agent results.
 *
 * Used by the Configure UI to show which examples will be injected as
 * few-shot examples in the judge prompt.
 */
export const trainingExamplesByConfig = query({
  args: {
    configId: v.id("evaluatorConfigs"),
    /** Optional override for unsaved slider preview in the UI */
    overrideMaxFewShot: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const config = await ctx.db.get(args.configId);
    if (!config || config.orgId !== orgId) return null;

    // Build the same eligibility set used by the actions
    const mappings = await ctx.db
      .query("failureModeQuestionMappings")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", config.experimentId),
      )
      .collect();
    const fmQuestionIds = new Set(
      mappings
        .filter((m) => m.failureModeId === config.failureModeId)
        .map((m) => m.questionId as string),
    );

    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", config.experimentId),
      )
      .collect();

    const eligibleIds: string[] = [];
    const labelByQuestion = new Map<string, "pass" | "fail">();
    const seen = new Set<string>();
    for (const a of annotations) {
      const qId = a.questionId as string;
      if (seen.has(qId)) continue;
      seen.add(qId);
      const label = toBinaryLabel(a.rating);
      if (fmQuestionIds.has(qId) || label === "pass") {
        eligibleIds.push(qId);
        labelByQuestion.set(qId, label);
      }
    }

    const split = computeSplit(
      eligibleIds,
      config.splitConfig,
      config.splitSeed,
      labelByQuestion,
    );

    // Stratified few-shot sampling from the training set
    const annotationByQuestion = new Map(
      annotations.map((a) => [a.questionId as string, a]),
    );
    const trainPasses: string[] = [];
    const trainFails: string[] = [];
    for (const qId of split.train) {
      const ann = annotationByQuestion.get(qId);
      if (!ann) continue;
      if (toBinaryLabel(ann.rating) === "pass") trainPasses.push(qId);
      else trainFails.push(qId);
    }

    const maxFewShot =
      args.overrideMaxFewShot ?? config.maxFewShotExamples ?? 8;
    const sampled = stratifiedFewShot(
      trainPasses,
      trainFails,
      maxFewShot,
      config.splitSeed,
    );

    // Hydrate the picked few-shot examples
    const agentResults = await ctx.db
      .query("agentExperimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", config.experimentId),
      )
      .collect();
    const resultByQuestion = new Map(
      agentResults.map((r) => [r.questionId as string, r]),
    );

    const fewShotExamples = [];
    for (const qId of sampled.ids) {
      const question = await ctx.db.get(qId as any);
      const annotation = annotationByQuestion.get(qId);
      const result = resultByQuestion.get(qId);
      if (!question || !annotation || !result) continue;
      fewShotExamples.push({
        questionId: qId,
        questionText: (question as any).queryText as string,
        answerText: result.answerText ?? "(no answer)",
        humanLabel: toBinaryLabel(annotation.rating),
      });
    }

    return {
      splitSizes: {
        train: split.train.length,
        dev: split.dev.length,
        test: split.test.length,
      },
      fewShotBreakdown: {
        passes: sampled.passCount,
        fails: sampled.failCount,
        total: sampled.ids.length,
        availablePasses: trainPasses.length,
        availableFails: trainFails.length,
      },
      fewShotExamples,
    };
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

const DEFAULT_OUTPUT_FORMAT = `{
  "reasoning": "<brief 1-2 sentence explanation>",
  "answer": "Pass" | "Fail"
}`;

const DEFAULT_JUDGE_PROMPT_TEMPLATE = (
  fmName: string,
  fmDescription: string,
) => `You are an expert evaluator assessing outputs from an AI agent.

Your Task: Determine if the agent's response exhibits the following failure mode.

Failure Mode: ${fmName}
Description: ${fmDescription}

Definition of Pass/Fail:
- Fail: The agent's response clearly exhibits this failure mode.
- Pass: The agent's response does NOT exhibit this failure mode.`;

export const createConfig = mutation({
  args: {
    experimentId: v.id("experiments"),
    name: v.string(),
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
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    // Pre-populate failureModeId with the first failure mode for the experiment
    const failureModes = await ctx.db
      .query("failureModes")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();

    if (failureModes.length === 0) {
      throw new Error(
        "Generate failure modes for this experiment before creating an evaluator",
      );
    }

    const defaultFm = failureModes.sort((a, b) => a.order - b.order)[0];

    return await ctx.db.insert("evaluatorConfigs", {
      orgId,
      experimentId: args.experimentId,
      failureModeId: defaultFm._id,
      name: args.name.trim() || defaultFm.name,
      judgePrompt: DEFAULT_JUDGE_PROMPT_TEMPLATE(
        defaultFm.name,
        defaultFm.description,
      ),
      outputFormatJson: DEFAULT_OUTPUT_FORMAT,
      fewShotExampleIds: [],
      maxFewShotExamples: 8,
      modelId: args.modelId ?? "claude-sonnet-4-6",
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
    name: v.optional(v.string()),
    failureModeId: v.optional(v.id("failureModes")),
    judgePrompt: v.optional(v.string()),
    outputFormatJson: v.optional(v.string()),
    maxFewShotExamples: v.optional(v.number()),
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

    if (args.name !== undefined) patch.name = args.name;
    if (args.failureModeId !== undefined) {
      // Validate the new failure mode belongs to same experiment + org
      const fm = await ctx.db.get(args.failureModeId);
      if (!fm || fm.orgId !== orgId)
        throw new Error("Failure mode not found");
      if (fm.experimentId !== config.experimentId)
        throw new Error("Failure mode must be from the same experiment");
      patch.failureModeId = args.failureModeId;
    }
    if (args.judgePrompt !== undefined) patch.judgePrompt = args.judgePrompt;
    if (args.outputFormatJson !== undefined)
      patch.outputFormatJson = args.outputFormatJson;
    if (args.maxFewShotExamples !== undefined)
      patch.maxFewShotExamples = args.maxFewShotExamples;
    if (args.modelId !== undefined) patch.modelId = args.modelId;
    if (args.splitConfig !== undefined) {
      patch.splitConfig = args.splitConfig;
      // Reset seed when split changes so data is re-shuffled
      patch.splitSeed = Math.floor(Math.random() * 2147483647);
    }

    // Reset metrics if anything that affects judgment changed
    if (
      args.judgePrompt !== undefined ||
      args.outputFormatJson !== undefined ||
      args.maxFewShotExamples !== undefined ||
      args.failureModeId !== undefined ||
      args.modelId !== undefined ||
      args.splitConfig !== undefined
    ) {
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
