import { v } from "convex/values";
import { internalMutation, query, mutation } from "../_generated/server";
import { getAuthContext } from "../lib/auth";

const generationConfigValidator = v.object({
  kbId: v.optional(v.id("knowledgeBases")),
  transcriptUploadId: v.optional(v.id("livechatUploads")),
  transcriptConversationIds: v.optional(
    v.array(v.id("livechatConversations")),
  ),
  targetCount: v.number(),
  distribution: v.optional(v.number()),
  fidelity: v.optional(v.number()),
  complexityDistribution: v.optional(
    v.object({ low: v.number(), medium: v.number(), high: v.number() }),
  ),
  model: v.optional(v.string()),
});

const sourceValidator = v.union(
  v.literal("synthetic"),
  v.literal("grounded"),
  v.literal("mixed"),
);

export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    source: sourceValidator,
    generationConfig: generationConfigValidator,
    generationJobId: v.id("scenarioGenJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scenarioSets", {
      ...args,
      scenarioCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const patchCount = internalMutation({
  args: {
    id: v.id("scenarioSets"),
    scenarioCount: v.number(),
  },
  handler: async (ctx, { id, scenarioCount }) => {
    await ctx.db.patch(id, { scenarioCount });
  },
});

export const deleteInternal = internalMutation({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", id))
      .collect();
    for (const s of scenarios) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return ctx.db
      .query("scenarioSets")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(id);
    if (!set || set.orgId !== orgId) return null;
    return set;
  },
});

export const remove = mutation({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(id);
    if (!set || set.orgId !== orgId) throw new Error("Set not found");

    const dependentSim = await ctx.db
      .query("conversationSimulations")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", id))
      .first();
    if (dependentSim) {
      throw new Error(
        "Cannot delete a scenario set referenced by a simulation",
      );
    }

    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", id))
      .collect();
    for (const s of scenarios) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});
