import { mutation, query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";
import { Doc } from "../_generated/dataModel";

const sourceValidator = v.union(
  v.object({
    kind: v.literal("conversation"),
    conversationId: v.id("conversations"),
  }),
  v.object({
    kind: v.literal("transcript"),
    transcriptId: v.id("livechatConversations"),
  }),
);

const ratingValidator = v.union(
  v.literal("great"),
  v.literal("good_enough"),
  v.literal("bad"),
  v.literal("pass"),
  v.literal("fail"),
);

type AnnotationSource =
  | { kind: "conversation"; conversationId: Doc<"conversations">["_id"] }
  | { kind: "transcript"; transcriptId: Doc<"livechatConversations">["_id"] };

async function queryAnnotationsBySource(
  ctx: any,
  source: AnnotationSource,
): Promise<Doc<"annotations">[]> {
  if (source.kind === "conversation") {
    return await ctx.db
      .query("annotations")
      .withIndex("by_conversation", (q: any) =>
        q.eq("source.conversationId", source.conversationId),
      )
      .collect();
  }
  return await ctx.db
    .query("annotations")
    .withIndex("by_transcript", (q: any) =>
      q.eq("source.transcriptId", source.transcriptId),
    )
    .collect();
}

export const upsert = mutation({
  args: {
    source: sourceValidator,
    rating: ratingValidator,
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);

    // Verify the source row exists and belongs to the org.
    if (args.source.kind === "conversation") {
      const conv = await ctx.db.get(args.source.conversationId);
      if (!conv || conv.orgId !== orgId) {
        throw new Error("Conversation not found");
      }
    } else {
      const tr = await ctx.db.get(args.source.transcriptId);
      if (!tr || tr.orgId !== orgId) {
        throw new Error("Transcript not found");
      }
    }

    const existing = await queryAnnotationsBySource(
      ctx,
      args.source as AnnotationSource,
    );
    const mine = existing.find((a) => a.ratedBy === user._id);

    if (mine) {
      await ctx.db.patch(mine._id, {
        rating: args.rating,
        comment: args.comment,
        tags: args.tags,
        updatedAt: Date.now(),
      });
      return mine._id;
    }

    return await ctx.db.insert("annotations", {
      orgId,
      source: args.source,
      rating: args.rating,
      comment: args.comment,
      tags: args.tags,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("annotations") },
  handler: async (ctx, { id }) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Annotation not found");
    if (row.ratedBy !== user._id) {
      throw new Error("Cannot remove someone else's annotation");
    }
    await ctx.db.delete(id);
  },
});

export const bySource = query({
  args: { source: sourceValidator },
  handler: async (ctx, { source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await queryAnnotationsBySource(
      ctx,
      source as AnnotationSource,
    );
    return rows.filter((r) => r.orgId === orgId);
  },
});

export const allTagsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("annotations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const tagSet = new Set<string>();
    for (const r of rows) for (const t of r.tags) tagSet.add(t);
    return Array.from(tagSet).sort();
  },
});

export const statsForSources = query({
  args: { sources: v.array(sourceValidator) },
  handler: async (ctx, { sources }) => {
    const { orgId } = await getAuthContext(ctx);
    let annotated = 0;
    let great = 0;
    let good_enough = 0;
    let bad = 0;
    let pass = 0;
    let fail = 0;
    for (const s of sources) {
      const rows = await queryAnnotationsBySource(ctx, s as AnnotationSource);
      for (const r of rows) {
        if (r.orgId !== orgId) continue;
        annotated++;
        if (r.rating === "great") great++;
        else if (r.rating === "good_enough") good_enough++;
        else if (r.rating === "bad") bad++;
        else if (r.rating === "pass") pass++;
        else if (r.rating === "fail") fail++;
      }
    }
    return {
      total: sources.length,
      annotated,
      great,
      good_enough,
      bad,
      pass,
      fail,
    };
  },
});

// ─── Internal (no auth, for use by actions) ───

export const bySourceInternal = internalQuery({
  args: { source: sourceValidator },
  handler: async (ctx, { source }) => {
    return await queryAnnotationsBySource(ctx, source as AnnotationSource);
  },
});

export const allForOrgInternal = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query("annotations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});
