// Internal helpers used by errorAnalysis/clustering.ts (which is "use node" and
// can only contain actions). These helpers live in a separate file so the
// clustering action can call them via ctx.runQuery / ctx.runMutation.

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getConversationInternal = internalQuery({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const listConversationMessagesInternal = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("asc")
      .collect();
  },
});

export const getLivechatInternal = internalQuery({
  args: { id: v.id("livechatConversations") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

// Delete all failure modes (and their memberships) for an errorAnalysis. Used
// by the re-cluster action which has "replace" semantics.
export const deleteFailureModesForAnalysisInternal = internalMutation({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }) => {
    const modes = await ctx.db
      .query("failureModes")
      .withIndex("by_analysis", (q) =>
        q.eq("errorAnalysisId", errorAnalysisId),
      )
      .collect();
    for (const m of modes) {
      const mships = await ctx.db
        .query("failureModeMemberships")
        .withIndex("by_failure_mode", (q) => q.eq("failureModeId", m._id))
        .collect();
      for (const mm of mships) await ctx.db.delete(mm._id);
      await ctx.db.delete(m._id);
    }
    return modes.length;
  },
});
