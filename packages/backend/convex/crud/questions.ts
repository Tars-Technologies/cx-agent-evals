import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { spanValidator } from "../lib/validators";

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
 * Public mutation: update a question's text and/or spans.
 * Clears langsmithExampleId to force re-sync on next experiment.
 */
export const updateQuestion = mutation({
  args: {
    questionId: v.id("questions"),
    queryText: v.optional(v.string()),
    relevantSpans: v.optional(v.array(spanValidator)),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const question = await ctx.db.get(args.questionId);
    if (!question) throw new Error("Question not found");

    // Verify org access via dataset
    const dataset = await ctx.db.get(question.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Question not found");
    }

    await ctx.db.patch(args.questionId, {
      langsmithExampleId: undefined,
      ...(args.queryText !== undefined && { queryText: args.queryText }),
      ...(args.relevantSpans !== undefined && { relevantSpans: args.relevantSpans }),
    });
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
        source: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Check for existing queryIds to prevent duplicate insertion on retry
    const existing = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    const existingQueryIds = new Set(existing.map((q) => q.queryId));

    const ids = [];
    for (const q of args.questions) {
      if (existingQueryIds.has(q.queryId)) {
        continue; // Skip duplicate
      }
      const id = await ctx.db.insert("questions", {
        datasetId: args.datasetId,
        queryId: q.queryId,
        queryText: q.queryText,
        sourceDocId: q.sourceDocId,
        relevantSpans: q.relevantSpans,
        metadata: q.metadata ?? {},
        source: q.source,
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

/**
 * Delete all questions belonging to a dataset.
 */
export const deleteByDataset = internalMutation({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();

    for (const q of questions) {
      await ctx.db.delete(q._id);
    }

    return { deleted: questions.length };
  },
});
