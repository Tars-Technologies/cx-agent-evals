import { query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { spanValidator } from "../lib/validators";

type QuestionStatus = "hit" | "partial" | "miss";

function statusFromRecall(recall: number | undefined): QuestionStatus {
  if (recall === undefined || recall === 0) return "miss";
  if (recall >= 0.999) return "hit";
  return "partial";
}

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

export const getDetailForExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const experiment = await ctx.db.get(args.experimentId);
    if (!experiment || experiment.orgId !== orgId) return null;

    const [retriever, dataset, results] = await Promise.all([
      experiment.retrieverId ? ctx.db.get(experiment.retrieverId) : null,
      ctx.db.get(experiment.datasetId),
      ctx.db
        .query("experimentResults")
        .withIndex("by_experiment", (q) =>
          q.eq("experimentId", args.experimentId),
        )
        .collect(),
    ]);

    const questions = await Promise.all(
      results.map(async (r) => {
        const question = await ctx.db.get(r.questionId);
        const recall = r.scores.recall;
        return {
          resultId: r._id,
          questionId: r.questionId,
          queryText: question?.queryText ?? "(question deleted)",
          sourceDocId: question?.sourceDocId ?? "",
          goldSpans: question?.relevantSpans ?? [],
          retrievedSpans: r.retrievedSpans,
          scores: r.scores,
          status: statusFromRecall(recall),
        };
      }),
    );

    return {
      experiment: {
        id: experiment._id,
        name: experiment.name,
        status: experiment.status,
        phase: experiment.phase ?? null,
        retrieverId: experiment.retrieverId ?? null,
        retrieverName: retriever?.name ?? "Unknown retriever",
        retrieverConfig: retriever?.retrieverConfig ?? experiment.retrieverConfig ?? null,
        datasetId: experiment.datasetId,
        datasetName: dataset?.name ?? "Unknown dataset",
        metricNames: experiment.metricNames,
        scores: experiment.scores ?? {},
        totalQuestions: experiment.totalQuestions ?? null,
        processedQuestions: experiment.processedQuestions ?? null,
        failedQuestions: experiment.failedQuestions ?? null,
        experimentRunId: experiment.experimentRunId ?? null,
        kbId: experiment.kbId ?? null,
      },
      questions,
    };
  },
});

export const insert = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    retrievedSpans: v.array(spanValidator),
    scores: v.record(v.string(), v.number()),
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
