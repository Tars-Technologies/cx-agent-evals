import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { wordCount, median, p90 } from "./lengthStats";

export const backfillGrounded = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db
      .query("conversationScenarios")
      .paginate({ numItems: batchSize ?? 50, cursor: cursor ?? null });

    let migrated = 0;
    for (const s of result.page) {
      if (s.referenceTranscript) continue;        // idempotent
      if (!s.sourceTranscriptId) continue;        // synthetic; skip
      const t = await ctx.db.get(s.sourceTranscriptId);
      if (!t) continue;                            // transcript deleted

      const wc = t.messages
        .filter((m) => m.role === "user")
        .map((m) => wordCount(m.text));

      const patch: Record<string, unknown> = {
        referenceTranscript: t.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "human_agent" | "workflow_input",
          text: m.text,
        })),
      };
      if (wc.length > 0) {
        patch.userMessageLengthStats = { median: median(wc), p90: p90(wc) };
      }

      await ctx.db.patch(s._id, patch);
      migrated++;
    }
    return {
      migrated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const pageScenariosForAnchors = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db
      .query("conversationScenarios")
      .paginate({ numItems: batchSize, cursor });
    return result;
  },
});

export const patchBehaviorAnchors = internalMutation({
  args: { id: v.id("conversationScenarios"), behaviorAnchors: v.array(v.string()) },
  handler: async (ctx, { id, behaviorAnchors }) => {
    await ctx.db.patch(id, { behaviorAnchors });
  },
});
