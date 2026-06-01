import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const sourceValidator = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
);

type Source =
  | { kind: "conversation"; conversationId: string }
  | { kind: "transcript"; transcriptId: string };

async function findMembership(
  ctx: any,
  failureModeId: string,
  source: Source,
) {
  const candidates = await ctx.db
    .query("failureModeMemberships")
    .withIndex("by_failure_mode", (q: any) => q.eq("failureModeId", failureModeId))
    .collect();
  if (source.kind === "conversation") {
    return candidates.find((c: any) =>
      c.source.kind === "conversation" && c.source.conversationId === source.conversationId
    );
  }
  return candidates.find((c: any) =>
    c.source.kind === "transcript" && c.source.transcriptId === source.transcriptId
  );
}

// ─── Public Mutations ───

export const add = mutation({
  args: { failureModeId: v.id("failureModes"), source: sourceValidator },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const fm = await ctx.db.get(args.failureModeId);
    if (!fm || fm.orgId !== orgId) throw new Error("Failure mode not found");

    const existing = await findMembership(ctx, args.failureModeId, args.source);
    if (existing) return existing._id;

    return await ctx.db.insert("failureModeMemberships", {
      orgId,
      failureModeId: args.failureModeId,
      source: args.source,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { failureModeId: v.id("failureModes"), source: sourceValidator },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const fm = await ctx.db.get(args.failureModeId);
    if (!fm || fm.orgId !== orgId) throw new Error("Failure mode not found");
    const existing = await findMembership(ctx, args.failureModeId, args.source);
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ─── Public Queries ───

export const byFailureMode = query({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, { failureModeId }) => {
    const { orgId } = await getAuthContext(ctx);
    const fm = await ctx.db.get(failureModeId);
    if (!fm || fm.orgId !== orgId) throw new Error("Failure mode not found");
    return await ctx.db
      .query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", failureModeId))
      .collect();
  },
});

// ─── Internal ───

export const byFailureModeInternal = internalQuery({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, { failureModeId }) => {
    return await ctx.db
      .query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", failureModeId))
      .collect();
  },
});

export const addInternal = internalMutation({
  args: {
    orgId: v.string(),
    failureModeId: v.id("failureModes"),
    source: sourceValidator,
  },
  handler: async (ctx, args) => {
    const existing = await findMembership(ctx, args.failureModeId, args.source);
    if (existing) return existing._id;
    return await ctx.db.insert("failureModeMemberships", {
      orgId: args.orgId,
      failureModeId: args.failureModeId,
      source: args.source,
      createdAt: Date.now(),
    });
  },
});
