import { query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const chunkValidator = v.object({
  content: v.string(),
  docId: v.string(),
  start: v.number(),
  end: v.number(),
});

const toolCallValidator = v.object({
  toolName: v.string(),
  query: v.string(),
  retrieverId: v.optional(v.string()),
  chunks: v.array(chunkValidator),
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
      .query("agentExperimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

export const byExperimentInternal = internalQuery({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentExperimentResults")
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
    answerText: v.string(),
    toolCalls: v.array(toolCallValidator),
    retrievedChunks: v.array(chunkValidator),
    scores: v.optional(v.record(v.string(), v.number())),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
    ),
    latencyMs: v.number(),
    status: v.union(v.literal("complete"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentExperimentResults", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
