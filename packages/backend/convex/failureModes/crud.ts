import { mutation, query, internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Queries ───

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    const modes = await ctx.db
      .query("failureModes")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
    return modes.sort((a, b) => a.order - b.order);
  },
});

export const get = query({
  args: { id: v.id("failureModes") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const mode = await ctx.db.get(id);
    if (!mode || mode.orgId !== orgId) throw new Error("Failure mode not found");
    return mode;
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    errorAnalysisId: v.id("errorAnalyses"),
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    const analysis = await ctx.db.get(args.errorAnalysisId);
    if (!analysis || analysis.orgId !== orgId) throw new Error("Error analysis not found");

    const existing = await ctx.db
      .query("failureModes")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const maxOrder = existing.reduce((max, m) => Math.max(max, m.order), -1);

    return await ctx.db.insert("failureModes", {
      orgId,
      agentId: args.agentId,
      errorAnalysisId: args.errorAnalysisId,
      name: args.name,
      description: args.description,
      order: maxOrder + 1,
      createdAt: Date.now(),
    });
  },
});

export const byAnalysis = query({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("failureModes")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", errorAnalysisId))
      .collect();
    return rows.filter((r) => r.orgId === orgId);
  },
});

export const update = mutation({
  args: {
    id: v.id("failureModes"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const { orgId } = await getAuthContext(ctx);
    const mode = await ctx.db.get(id);
    if (!mode || mode.orgId !== orgId) throw new Error("Failure mode not found");
    const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("failureModes") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const mode = await ctx.db.get(id);
    if (!mode || mode.orgId !== orgId) throw new Error("Failure mode not found");

    // Cascade: delete memberships
    const memberships = await ctx.db
      .query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.db.delete(id);
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("failureModes") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const byAgentInternal = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const modes = await ctx.db
      .query("failureModes")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
    return modes.sort((a, b) => a.order - b.order);
  },
});

export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    errorAnalysisId: v.id("errorAnalyses"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("failureModes", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
