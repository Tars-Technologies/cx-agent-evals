import { mutation, query, internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    return agent;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    identity: v.object({
      agentName: v.string(),
      companyName: v.string(),
      companyUrl: v.optional(v.string()),
      companyContext: v.optional(v.string()),
      roleDescription: v.string(),
      brandVoice: v.optional(v.string()),
    }),
    guardrails: v.object({
      outOfScope: v.optional(v.string()),
      escalationRules: v.optional(v.string()),
      compliance: v.optional(v.string()),
    }),
    responseStyle: v.object({
      formatting: v.optional(v.string()),
      length: v.optional(v.string()),
      formality: v.optional(v.string()),
      language: v.optional(v.string()),
    }),
    additionalInstructions: v.optional(v.string()),
    model: v.string(),
    enableReflection: v.boolean(),
    retrieverIds: v.array(v.id("retrievers")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.insert("agents", {
      ...args,
      orgId,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    identity: v.optional(
      v.object({
        agentName: v.string(),
        companyName: v.string(),
        companyUrl: v.optional(v.string()),
        companyContext: v.optional(v.string()),
        roleDescription: v.string(),
        brandVoice: v.optional(v.string()),
      }),
    ),
    guardrails: v.optional(
      v.object({
        outOfScope: v.optional(v.string()),
        escalationRules: v.optional(v.string()),
        compliance: v.optional(v.string()),
      }),
    ),
    responseStyle: v.optional(
      v.object({
        formatting: v.optional(v.string()),
        length: v.optional(v.string()),
        formality: v.optional(v.string()),
        language: v.optional(v.string()),
      }),
    ),
    additionalInstructions: v.optional(v.string()),
    model: v.optional(v.string()),
    enableReflection: v.optional(v.boolean()),
    retrieverIds: v.optional(v.array(v.id("retrievers"))),
    status: v.optional(v.union(v.literal("draft"), v.literal("ready"), v.literal("error"))),
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    await ctx.db.delete(id);
  },
});

// ─── Internal Queries/Mutations ───

export const getInternal = internalQuery({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

export const updateInternal = internalMutation({
  args: {
    id: v.id("agents"),
    identity: v.optional(v.object({
      agentName: v.string(),
      companyName: v.string(),
      companyUrl: v.optional(v.string()),
      companyContext: v.optional(v.string()),
      roleDescription: v.string(),
      brandVoice: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { id, ...patch }) => {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) updates[key] = value;
    }
    await ctx.db.patch(id, updates);
  },
});
