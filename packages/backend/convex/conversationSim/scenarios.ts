import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Shared validators ───

const personaValidator = v.object({
  type: v.string(),
  traits: v.array(v.string()),
  communicationStyle: v.string(),
  patienceLevel: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
});

const complexityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const referenceMessagesArrayValidator = v.array(
  v.object({
    role: v.literal("user"),
    content: v.string(),
    turnIndex: v.number(),
  }),
);
const referenceMessagesValidator = v.optional(referenceMessagesArrayValidator);

const scenarioFields = {
  datasetId: v.id("datasets"),
  persona: personaValidator,
  topic: v.string(),
  intent: v.string(),
  complexity: complexityValidator,
  reasonForContact: v.string(),
  knownInfo: v.string(),
  unknownInfo: v.string(),
  instruction: v.string(),
  referenceMessages: referenceMessagesValidator,
};

// ─── Queries ───

export const byDataset = query({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, { datasetId }) => {
    const { orgId } = await getAuthContext(ctx);
    const dataset = await ctx.db.get(datasetId);
    if (!dataset || dataset.orgId !== orgId)
      throw new Error("Dataset not found");
    return ctx.db
      .query("conversationScenarios")
      .withIndex("by_dataset", (q) => q.eq("datasetId", datasetId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const scenario = await ctx.db.get(id);
    if (!scenario || scenario.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    return scenario;
  },
});

// ─── Mutations ───

export const create = mutation({
  args: scenarioFields,
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("conversationScenarios", { orgId, ...args });
  },
});

export const update = mutation({
  args: {
    id: v.id("conversationScenarios"),
    persona: v.optional(personaValidator),
    topic: v.optional(v.string()),
    intent: v.optional(v.string()),
    complexity: v.optional(complexityValidator),
    reasonForContact: v.optional(v.string()),
    knownInfo: v.optional(v.string()),
    unknownInfo: v.optional(v.string()),
    instruction: v.optional(v.string()),
    referenceMessages: v.optional(referenceMessagesArrayValidator),
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    await ctx.db.delete(id);
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const createInternal = internalMutation({
  args: {
    ...scenarioFields,
    orgId: v.string(),
    sourceType: v.optional(v.union(v.literal("transcript_grounded"), v.literal("synthetic"))),
    sourceTranscriptId: v.optional(v.id("livechatConversations")),
    languages: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationScenarios", args);
  },
});
