import { mutation, internalMutation } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import {
  Workpool,
  vOnCompleteArgs,
  type RunResult,
} from "@convex-dev/workpool";
import { getAuthContext } from "../lib/auth";

// Reuse conversationSimPool — generation and simulation are low-traffic
const pool = new Workpool(components.conversationSimPool, {
  maxParallelism: 1, // Only 1 generation at a time
});

// ─── Start Generation ───

export const startGeneration = mutation({
  args: {
    datasetId: v.id("datasets"),
    count: v.optional(v.number()),
    model: v.optional(v.string()),
    complexityDistribution: v.optional(
      v.object({
        low: v.number(),
        medium: v.number(),
        high: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId)
      throw new Error("Dataset not found");
    if (dataset.type !== "conversation_sim")
      throw new Error("Dataset must be conversation_sim type");

    const count = args.count ?? 10;

    await pool.enqueueAction(
      ctx,
      internal.conversationSim.generationActions.generateScenarios,
      {
        datasetId: args.datasetId,
        kbId: dataset.kbId,
        orgId,
        config: {
          count,
          model: args.model,
          complexityDistribution: args.complexityDistribution,
        },
      },
      {
        context: { datasetId: args.datasetId as string },
        onComplete:
          internal.conversationSim.generation.onGenerationComplete,
      },
    );

    return { started: true };
  },
});

// ─── WorkPool Callback ───

export const onGenerationComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ datasetId: v.string() })),
  handler: async (
    _ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { datasetId: string };
      result: RunResult;
    },
  ) => {
    // The action already saved scenarios and updated the count.
    // This callback exists for WorkPool integration.
    if (result.kind === "failed") {
      console.error(
        `Scenario generation failed for dataset ${context.datasetId}:`,
        result.error,
      );
    }
  },
});
