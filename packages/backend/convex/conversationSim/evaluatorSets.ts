import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Queries ───

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("evaluatorSets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("evaluatorSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(id);
    if (!set || set.orgId !== orgId) {
      throw new Error("Evaluator set not found");
    }
    return set;
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    evaluatorIds: v.array(v.id("evaluators")),
    requiredEvaluatorIds: v.array(v.id("evaluators")),
    passThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("evaluatorSets", { orgId, ...args });
  },
});

export const update = mutation({
  args: {
    id: v.id("evaluatorSets"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    evaluatorIds: v.optional(v.array(v.id("evaluators"))),
    requiredEvaluatorIds: v.optional(v.array(v.id("evaluators"))),
    passThreshold: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator set not found");
    }
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("evaluatorSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator set not found");
    }
    await ctx.db.delete(id);
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("evaluatorSets") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});
