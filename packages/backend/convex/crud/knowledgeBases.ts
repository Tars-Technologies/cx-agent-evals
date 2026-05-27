import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  mutation,
  query
} from "../_generated/server"
import { getAuthContext } from "../lib/auth"

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
    tags: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx)

    // Look up or create the user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique()
    if (!user) {
      throw new Error("User not found. Please sign in again.")
    }

    return await ctx.db.insert("knowledgeBases", {
      orgId,
      name: args.name,
      description: args.description,
      metadata: args.metadata ?? {},
      industry: args.industry,
      subIndustry: args.subIndustry,
      company: args.company,
      entityType: args.entityType,
      sourceUrl: args.sourceUrl,
      tags: args.tags,
      createdBy: user._id,
      createdAt: Date.now()
    })
  }
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx)

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect()
  }
})

export const listByIndustry = query({
  args: { industry: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx)
    if (args.industry) {
      return await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!)
        )
        .order("desc")
        .collect()
    }
    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect()
  }
})

export const listWithDocCounts = query({
  args: { industry: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx)
    let kbs
    if (args.industry) {
      kbs = await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!)
        )
        .order("desc")
        .collect()
    } else {
      kbs = await ctx.db
        .query("knowledgeBases")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .order("desc")
        .collect()
    }
    return kbs.map((kb) => ({
      ...kb,
      documentCount: kb.documentCount ?? 0
    }))
  }
})

/**
 * Backfill documentCount on a single KB by paginating through documents.
 * Reads content along with each row — keep batch size small to stay under
 * the 16MB per-mutation read limit.
 *
 * Returns { done, processed, cursor }. Caller (action) drives the loop.
 */
export const backfillOneKb = internalMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    cursor: v.union(v.string(), v.null()),
    batchSize: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db.get(args.kbId)
    if (!kb) return { done: true, processedDelta: 0, cursor: null }
    const page = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .paginate({ numItems: args.batchSize ?? 200, cursor: args.cursor })
    return {
      done: page.isDone,
      processedDelta: page.page.length,
      cursor: page.continueCursor
    }
  }
})

/**
 * Sets documentCount on a KB after counting has finished externally.
 */
export const setDocumentCount = internalMutation({
  args: { kbId: v.id("knowledgeBases"), count: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.kbId, { documentCount: args.count })
  }
})

/**
 * Lists KB ids needing backfill (documentCount === undefined).
 */
export const listKbsMissingCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const kbs = await ctx.db.query("knowledgeBases").collect()
    return kbs
      .filter((kb) => kb.documentCount === undefined)
      .map((kb) => kb._id)
  }
})

export const get = query({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx)

    const kb = await ctx.db.get(args.id)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }
    return kb
  }
})

// ─── Internal Queries ───

export const getInternal = internalQuery({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id)
  }
})
