import { query, internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Public Queries ───

// List runs for a simulation
export const bySimulation = query({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(simulationId);
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");
    return ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation", (q) => q.eq("simulationId", simulationId))
      .collect();
  },
});

// Runs for a specific scenario within a simulation
export const bySimulationScenario = query({
  args: {
    simulationId: v.id("conversationSimulations"),
    scenarioId: v.id("conversationScenarios"),
  },
  handler: async (ctx, { simulationId, scenarioId }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(simulationId);
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");
    return ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation_scenario", (q) =>
        q.eq("simulationId", simulationId).eq("scenarioId", scenarioId),
      )
      .collect();
  },
});

// Get single run
export const get = query({
  args: { id: v.id("conversationSimRuns") },
  handler: async (ctx, { id }) => {
    await getAuthContext(ctx); // auth gate
    return ctx.db.get(id);
  },
});

// ─── Internal Mutations ───

// Create run
export const createRun = internalMutation({
  args: {
    simulationId: v.id("conversationSimulations"),
    scenarioId: v.id("conversationScenarios"),
    agentId: v.id("agents"),
    kIndex: v.number(),
    seed: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("conversationSimRuns", {
      ...args,
      status: "pending",
    });
  },
});

// Update run status and results
export const updateRun = internalMutation({
  args: {
    runId: v.id("conversationSimRuns"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    conversationId: v.optional(v.id("conversations")),
    terminationReason: v.optional(
      v.union(
        v.literal("user_stop"),
        v.literal("agent_stop"),
        v.literal("max_turns"),
        v.literal("timeout"),
        v.literal("error"),
      ),
    ),
    turnCount: v.optional(v.number()),
    evaluatorResults: v.optional(
      v.array(
        v.object({
          evaluatorId: v.id("evaluators"),
          evaluatorName: v.string(),
          passed: v.boolean(),
          justification: v.string(),
          required: v.boolean(),
        }),
      ),
    ),
    score: v.optional(v.number()),
    passed: v.optional(v.boolean()),
    toolCallCount: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    annotations: v.optional(v.string()),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(runId, updates);
    }
  },
});

// ─── Internal Queries ───

// Get run (for actions)
export const getInternal = internalQuery({
  args: { id: v.id("conversationSimRuns") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});
