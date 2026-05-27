import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

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
