import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "./lib/auth";
import { spanValidator } from "./lib/validators";

export const byDataset = query({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify dataset belongs to org
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }

    return await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

/**
 * Insert a batch of questions into a dataset.
 * Called from generation actions after producing questions.
 */
export const insertBatch = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    questions: v.array(
      v.object({
        queryId: v.string(),
        queryText: v.string(),
        sourceDocId: v.string(),
        relevantSpans: v.array(spanValidator),
        metadata: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const q of args.questions) {
      const id = await ctx.db.insert("questions", {
        datasetId: args.datasetId,
        queryId: q.queryId,
        queryText: q.queryText,
        sourceDocId: q.sourceDocId,
        relevantSpans: q.relevantSpans,
        metadata: q.metadata ?? {},
      });
      ids.push(id);
    }
    return ids;
  },
});

/**
 * Internal query: list all questions in a dataset (no auth check).
 */
export const byDatasetInternal = internalQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
  },
});

/**
 * Internal query: get a single question by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { id: v.id("questions") },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.id);
    if (!question) throw new Error("Question not found");
    return question;
  },
});

/**
 * Batch-update langsmithExampleId on questions after dataset sync.
 */
export const updateLangsmithExampleIds = internalMutation({
  args: {
    updates: v.array(
      v.object({
        questionId: v.id("questions"),
        langsmithExampleId: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const { questionId, langsmithExampleId } of args.updates) {
      await ctx.db.patch(questionId, { langsmithExampleId });
    }
  },
});

export const updateSpans = internalMutation({
  args: {
    questionId: v.id("questions"),
    relevantSpans: v.array(spanValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.questionId, {
      relevantSpans: args.relevantSpans,
    });
  },
});
