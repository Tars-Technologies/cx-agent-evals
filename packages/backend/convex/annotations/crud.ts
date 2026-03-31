import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";

export const upsert = mutation({
  args: {
    resultId: v.id("agentExperimentResults"),
    rating: v.union(
      v.literal("great"),
      v.literal("good_enough"),
      v.literal("bad"),
    ),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);

    // Load the result to get experimentId and questionId
    const result = await ctx.db.get(args.resultId);
    if (!result) throw new Error("Result not found");

    // Verify experiment belongs to org
    const experiment = await ctx.db.get(result.experimentId);
    if (!experiment || experiment.orgId !== orgId) {
      throw new Error("Experiment not found");
    }

    // Check for existing annotation by this user on this result
    const existing = await ctx.db
      .query("annotations")
      .withIndex("by_result", (q) => q.eq("resultId", args.resultId))
      .collect();
    const myAnnotation = existing.find((a) => a.ratedBy === user._id);

    if (myAnnotation) {
      await ctx.db.patch(myAnnotation._id, {
        rating: args.rating,
        comment: args.comment,
        updatedAt: Date.now(),
      });
      return myAnnotation._id;
    }

    return await ctx.db.insert("annotations", {
      orgId,
      experimentId: result.experimentId,
      resultId: args.resultId,
      questionId: result.questionId,
      rating: args.rating,
      comment: args.comment,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const byExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) {
      throw new Error("Experiment not found");
    }

    return await ctx.db
      .query("annotations")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

export const stats = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) {
      throw new Error("Experiment not found");
    }

    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();

    const results = await ctx.db
      .query("agentExperimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();

    const total = results.length;
    let great = 0;
    let good_enough = 0;
    let bad = 0;
    for (const a of annotations) {
      if (a.rating === "great") great++;
      else if (a.rating === "good_enough") good_enough++;
      else if (a.rating === "bad") bad++;
    }

    return {
      total,
      annotated: annotations.length,
      great,
      good_enough,
      bad,
    };
  },
});
