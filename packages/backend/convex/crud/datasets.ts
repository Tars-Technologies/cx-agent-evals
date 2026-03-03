import { query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);

    return await ctx.db
      .query("datasets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
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
      .query("datasets")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.id);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }
    return dataset;
  },
});

/**
 * Update dataset with LangSmith sync info.
 */
export const updateSyncStatus = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    langsmithDatasetId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string()),
    langsmithSyncStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      langsmithSyncStatus: args.langsmithSyncStatus,
    };
    if (args.langsmithDatasetId !== undefined)
      patch.langsmithDatasetId = args.langsmithDatasetId;
    if (args.langsmithUrl !== undefined)
      patch.langsmithUrl = args.langsmithUrl;

    await ctx.db.patch(args.datasetId, patch);
  },
});

/**
 * Internal query: get a dataset by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id);
    if (!dataset) throw new Error("Dataset not found");
    return dataset;
  },
});

export const updateQuestionCount = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    questionCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.datasetId, {
      questionCount: args.questionCount,
    });
  },
});
