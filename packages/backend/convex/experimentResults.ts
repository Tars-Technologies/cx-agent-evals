import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "./lib/auth";
import { spanValidator } from "./lib/validators";

export const byExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify experiment belongs to org
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) {
      throw new Error("Experiment not found");
    }

    return await ctx.db
      .query("experimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

/**
 * Internal query: list all results for an experiment (no auth check).
 */
export const byExperimentInternal = internalQuery({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("experimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

export const insert = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    retrievedSpans: v.array(spanValidator),
    scores: v.any(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("experimentResults", {
      experimentId: args.experimentId,
      questionId: args.questionId,
      retrievedSpans: args.retrievedSpans,
      scores: args.scores,
      metadata: args.metadata ?? {},
    });
  },
});
