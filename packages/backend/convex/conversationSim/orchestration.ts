import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import {
  Workpool,
  WorkId,
  vOnCompleteArgs,
  type RunResult,
} from "@convex-dev/workpool";
import { getAuthContext, lookupUser } from "../lib/auth";
import { Id } from "../_generated/dataModel";

const pool = new Workpool(components.conversationSimPool, {
  maxParallelism: 3,
});

// ─── Start Simulation ───

export const start = mutation({
  args: {
    agentId: v.id("agents"),
    datasetId: v.id("datasets"),
    evaluatorSetId: v.id("evaluatorSets"),
    k: v.optional(v.number()),
    passThreshold: v.optional(v.number()),
    concurrency: v.optional(v.number()),
    maxTurns: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    userSimModel: v.optional(v.string()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Validate agent
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    if (agent.status !== "ready") throw new Error("Agent is not ready");

    // Validate dataset is conversation_sim type
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId)
      throw new Error("Dataset not found");
    if (dataset.type !== "conversation_sim")
      throw new Error("Dataset must be conversation_sim type");

    // Validate evaluator set
    const evalSet = await ctx.db.get(args.evaluatorSetId);
    if (!evalSet || evalSet.orgId !== orgId)
      throw new Error("Evaluator set not found");

    // Lookup user for userId field
    const user = await lookupUser(ctx, userId);

    const k = args.k ?? 1;
    const maxTurns = args.maxTurns ?? 20;
    const timeoutMs = args.timeoutMs ?? 300000;
    const concurrency = args.concurrency ?? 3;
    const passThreshold = args.passThreshold ?? 0.8;
    const userSimModel = args.userSimModel ?? "claude-sonnet-4-20250514";

    // Load all scenarios for dataset
    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();

    if (scenarios.length === 0) throw new Error("Dataset has no scenarios");

    const totalRuns = scenarios.length * k;

    // Create simulation record
    const simulationId = await ctx.db.insert("conversationSimulations", {
      orgId,
      userId: user._id,
      datasetId: args.datasetId,
      agentId: args.agentId,
      evaluatorSetId: args.evaluatorSetId,
      k,
      passThreshold,
      concurrency,
      maxTurns,
      timeoutMs,
      userSimModel,
      seed: args.seed,
      status: "running",
      totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      startedAt: Date.now(),
    });

    // Create runs and enqueue via WorkPool
    const workIds: WorkId[] = [];
    const baseSeed = args.seed ?? Math.floor(Math.random() * 1000000);

    for (const scenario of scenarios) {
      for (let ki = 0; ki < k; ki++) {
        const seed = baseSeed + ki;

        const runId = await ctx.db.insert("conversationSimRuns", {
          simulationId,
          scenarioId: scenario._id,
          agentId: args.agentId,
          kIndex: ki,
          seed,
          status: "pending",
        });

        const wId = await pool.enqueueAction(
          ctx,
          internal.conversationSim.actions.runConversationSim,
          { runId },
          {
            context: { simulationId, runId: runId as string },
            onComplete:
              internal.conversationSim.orchestration.onRunComplete,
          },
        );
        workIds.push(wId);
      }
    }

    // Store workIds for cancellation
    await ctx.db.patch(simulationId, { workIds: workIds as string[] });

    return simulationId;
  },
});

// ─── On Run Complete (WorkPool callback) ───

export const onRunComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      simulationId: v.string(),
      runId: v.string(),
    }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { simulationId: string; runId: string };
      result: RunResult;
    },
  ) => {
    const simId = context.simulationId as Id<"conversationSimulations">;
    const sim = await ctx.db.get(simId);
    if (!sim) return;
    if (sim.status === "cancelled") return;

    const completedRuns =
      sim.completedRuns + (result.kind === "success" ? 1 : 0);
    const failedRuns =
      (sim.failedRuns ?? 0) + (result.kind === "failed" ? 1 : 0);
    const totalHandled = completedRuns + failedRuns;

    if (totalHandled >= sim.totalRuns) {
      // All runs done — compute aggregate stats
      const allRuns = await ctx.db
        .query("conversationSimRuns")
        .withIndex("by_simulation", (q) => q.eq("simulationId", simId))
        .collect();

      // Pass rate: % of scenarios where ALL k runs passed
      const scenarioMap = new Map<string, boolean[]>();
      for (const run of allRuns) {
        const key = run.scenarioId as string;
        if (!scenarioMap.has(key)) scenarioMap.set(key, []);
        scenarioMap.get(key)!.push(run.passed ?? false);
      }

      let scenariosPassed = 0;
      for (const [, passes] of scenarioMap) {
        if (passes.every((p) => p)) scenariosPassed++;
      }
      const overallPassRate =
        scenarioMap.size > 0 ? scenariosPassed / scenarioMap.size : 0;

      // Avg score: mean of all run scores
      const scores = allRuns
        .map((r) => r.score)
        .filter((s): s is number => s !== undefined);
      const avgScore =
        scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : undefined;

      await ctx.db.patch(simId, {
        completedRuns,
        failedRuns,
        overallPassRate,
        avgScore,
        status: failedRuns === sim.totalRuns ? "failed" : "completed",
        completedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(simId, {
        completedRuns,
        failedRuns,
      });
    }
  },
});

// ─── Cancel Simulation ───

export const cancel = mutation({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(simulationId);
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");
    if (sim.status !== "running" && sim.status !== "pending") {
      throw new Error(`Cannot cancel simulation in status: ${sim.status}`);
    }

    await ctx.db.patch(simulationId, { status: "cancelled" });

    const workIds = sim.workIds ?? [];
    for (const wId of workIds) {
      await pool.cancel(ctx, wId as WorkId);
    }
  },
});

// ─── Queries ───

// Get simulation
export const get = query({
  args: { id: v.id("conversationSimulations") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(id);
    if (!sim || sim.orgId !== orgId) return null;
    return sim;
  },
});

// List simulations for org
export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db
      .query("conversationSimulations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

// Internal get (for actions — no auth)
export const getInternal = internalQuery({
  args: { id: v.id("conversationSimulations") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

// List simulations for specific agent
export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return ctx.db
      .query("conversationSimulations")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .collect();
  },
});
