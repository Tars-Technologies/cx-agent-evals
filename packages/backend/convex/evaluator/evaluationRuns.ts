import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const resultSourceValidator = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"), transcriptId: v.id("livechatConversations") }),
);

export const insertRunInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    evaluatorId: v.id("evaluators"),
    simulationId: v.id("conversationSimulations"),
    n: v.number(),
    observedPassRate: v.number(),
    correctedPassRate: v.number(),
    ci: v.object({ lower: v.number(), upper: v.number() }),
    corrected: v.boolean(),
    results: v.array(
      v.object({
        source: resultSourceValidator,
        passed: v.boolean(),
        justification: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("evaluationRuns", {
      orgId: args.orgId,
      agentId: args.agentId,
      evaluatorId: args.evaluatorId,
      cohort: { kind: "simulation", simulationId: args.simulationId },
      n: args.n,
      observedPassRate: args.observedPassRate,
      correctedPassRate: args.correctedPassRate,
      ci: args.ci,
      corrected: args.corrected,
      createdAt: Date.now(),
    });
    for (const r of args.results) {
      await ctx.db.insert("evaluationResults", {
        orgId: args.orgId,
        evaluationRunId: runId,
        source: r.source,
        passed: r.passed,
        justification: r.justification,
      });
    }
    return runId;
  },
});

/** Latest evaluationRun per evaluator for a simulation cohort. */
export const bySimulation = query({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("evaluationRuns")
      .withIndex("by_simulation", (q) => q.eq("cohort.simulationId", simulationId))
      .collect();
    const mine = rows.filter((r) => r.orgId === orgId);
    const latest = new Map<string, (typeof mine)[number]>();
    for (const r of mine) {
      const prev = latest.get(r.evaluatorId);
      if (!prev || r.createdAt > prev.createdAt) latest.set(r.evaluatorId, r);
    }
    return Array.from(latest.values());
  },
});
