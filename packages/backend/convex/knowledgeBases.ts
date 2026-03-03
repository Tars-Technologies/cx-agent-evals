import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "./lib/auth";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    metadata: v.optional(v.any()),
    industry: v.optional(v.string()),
    subIndustry: v.optional(v.string()),
    company: v.optional(v.string()),
    entityType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Look up or create the user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) {
      throw new Error("User not found. Please sign in again.");
    }

    return await ctx.db.insert("knowledgeBases", {
      orgId,
      name: args.name,
      description: args.description,
      metadata: args.metadata ?? {},
      createdBy: user._id,
      createdAt: Date.now(),
      ...(args.industry !== undefined && { industry: args.industry }),
      ...(args.subIndustry !== undefined && { subIndustry: args.subIndustry }),
      ...(args.company !== undefined && { company: args.company }),
      ...(args.entityType !== undefined && { entityType: args.entityType }),
      ...(args.sourceUrl !== undefined && { sourceUrl: args.sourceUrl }),
      ...(args.tags !== undefined && { tags: args.tags }),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const listByIndustry = query({
  args: {
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    if (args.industry) {
      return await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry),
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.id);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }
    return kb;
  },
});
