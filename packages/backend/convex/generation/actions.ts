"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  SimpleStrategy,
  DimensionDrivenStrategy,
  RealWorldGroundedStrategy,
  GroundTruthAssigner,
  OpenAIEmbedder,
  createCorpusFromDocuments,
  parseDimensions,
} from "rag-evaluation-system";
import { createLLMClient, getModel } from "rag-evaluation-system/llm";
import { QUESTION_INSERT_BATCH_SIZE } from "rag-evaluation-system/shared";
import OpenAI from "openai";

async function loadCorpusFromKb(
  ctx: { runQuery: (ref: any, args: any) => Promise<any> },
  kbId: Id<"knowledgeBases">,
) {
  const docs = await ctx.runQuery(internal.crud.documents.listByKbInternal, {
    kbId,
  });
  return {
    corpus: createCorpusFromDocuments(
      docs.map((d: any) => ({ id: d.docId, content: d.content })),
    ),
    docs,
  };
}

// ─── Whole-Corpus Generation (Simple Strategy) ───

export const generateSimple = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as Record<string, unknown>;
    const totalQuestions = (config.totalQuestions as number) ?? 30;
    const model = getModel(config);
    const llmClient = createLLMClient();

    const { corpus } = await loadCorpusFromKb(ctx, args.kbId);

    const strategy = new SimpleStrategy({ totalQuestions });
    const queries = await strategy.generate({ corpus, llmClient, model });

    if (queries.length > 0) {
      for (let i = 0; i < queries.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = queries.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch.map((q, idx) => ({
            queryId: `simple_q${i + idx}`,
            queryText: q.query,
            sourceDocId: q.targetDocId,
            relevantSpans: [],
            metadata: q.metadata,
          })),
        });
      }
    }

    return { questionsGenerated: queries.length };
  },
});

// ─── Whole-Corpus Generation (Dimension-Driven) ───

export const generateDimensionDriven = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as Record<string, unknown>;
    const model = getModel(config);
    const llmClient = createLLMClient();

    const { corpus } = await loadCorpusFromKb(ctx, args.kbId);

    const dimensions = parseDimensions(config.dimensions);
    const totalQuestions = (config.totalQuestions as number) ?? 50;

    const strategy = new DimensionDrivenStrategy({
      dimensions,
      totalQuestions,
    });

    const queries = await strategy.generate({ corpus, llmClient, model });

    if (queries.length > 0) {
      for (let i = 0; i < queries.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = queries.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch.map((q, idx) => ({
            queryId: `dd_q${i + idx}`,
            queryText: q.query,
            sourceDocId: q.targetDocId,
            relevantSpans: [],
            metadata: q.metadata,
          })),
        });
      }
    }

    return { questionsGenerated: queries.length };
  },
});

// ─── Whole-Corpus Generation (Real-World-Grounded) ───

export const generateRealWorldGrounded = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as Record<string, unknown>;
    const model = getModel(config);
    const llmClient = createLLMClient();

    const { corpus } = await loadCorpusFromKb(ctx, args.kbId);

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const embedder = new OpenAIEmbedder({
      model: (config.embeddingModel as string) ?? "text-embedding-3-small",
      client: openai,
    });

    const strategy = new RealWorldGroundedStrategy({
      questions: (config.questions as string[]) ?? [],
      totalSyntheticQuestions:
        (config.totalSyntheticQuestions as number) ?? 50,
      matchThreshold: config.matchThreshold as number | undefined,
      fewShotExamplesPerDoc: config.fewShotExamplesPerDoc as
        | number
        | undefined,
    });

    const queries = await strategy.generate({
      corpus,
      llmClient,
      model,
      embedder,
    });

    if (queries.length > 0) {
      for (let i = 0; i < queries.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = queries.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch.map((q, idx) => ({
            queryId: `rwg_q${i + idx}`,
            queryText: q.query,
            sourceDocId: q.targetDocId,
            relevantSpans: [],
            metadata: q.metadata,
          })),
        });
      }
    }

    return { questionsGenerated: queries.length };
  },
});

// ─── Per-Question Ground Truth Assignment ───

export const assignGroundTruthForQuestion = internalAction({
  args: {
    questionId: v.id("questions"),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    const question = await ctx.runQuery(internal.crud.questions.getInternal, {
      id: args.questionId,
    });

    const { corpus } = await loadCorpusFromKb(ctx, args.kbId);

    const dataset = await ctx.runQuery(internal.crud.datasets.getInternal, {
      id: args.datasetId,
    });
    const config = dataset.strategyConfig as Record<string, unknown>;
    const model = getModel(config);
    const llmClient = createLLMClient();
    const assigner = new GroundTruthAssigner();

    const results = await assigner.assign(
      [
        {
          query: question.queryText,
          targetDocId: question.sourceDocId,
          metadata: (question.metadata ?? {}) as Record<string, string>,
        },
      ],
      { corpus, llmClient, model },
    );

    if (results.length > 0 && results[0].relevantSpans.length > 0) {
      const spans = results[0].relevantSpans.map((s) => ({
        docId: String(s.docId),
        start: s.start,
        end: s.end,
        text: s.text,
      }));

      await ctx.runMutation(internal.crud.questions.updateSpans, {
        questionId: args.questionId,
        relevantSpans: spans,
      });

      return { spansFound: spans.length };
    }

    return { spansFound: 0 };
  },
});
