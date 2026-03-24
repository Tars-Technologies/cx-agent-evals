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
  calculateQuotas,
  matchRealWorldQuestions,
  filterCombinations,
  generateForDocument,
  findCitationSpan,
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

// ─── Unified Pipeline: Phase 1 — Prepare Generation Plan ───

export const prepareGeneration = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as Record<string, unknown>;
    const { corpus, docs } = await loadCorpusFromKb(ctx, args.kbId);
    const llmClient = createLLMClient();
    const model = getModel(config);

    // Read document priorities
    const docPriorities = docs.map((d: any) => ({
      id: d.docId as string,
      priority: (d.priority as number) ?? 3,
    }));

    // Quota allocation
    const totalQuestions = (config.totalQuestions as number) ?? 30;
    const overrides = config.allocationOverrides as
      | Record<string, number>
      | undefined;
    const quotas = calculateQuotas(docPriorities, totalQuestions, overrides);

    // Real-world question matching (if provided)
    let matchedByDoc: Record<string, any[]> = {};
    let unmatchedQuestions: string[] = [];
    const realWorldQuestions = config.realWorldQuestions as
      | string[]
      | undefined;
    if (realWorldQuestions?.length) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embedder = new OpenAIEmbedder({
        model:
          (config.embeddingModel as string) ?? "text-embedding-3-small",
        client: openai,
      });
      const result = await matchRealWorldQuestions(
        corpus,
        realWorldQuestions,
        embedder,
      );
      matchedByDoc = result.matchedByDoc;
      unmatchedQuestions = result.unmatchedQuestions;
    }

    // Dimension filtering (if provided)
    let validCombos: Record<string, string>[] = [];
    const dimensions = config.dimensions as any[] | undefined;
    if (dimensions?.length) {
      const parsed = parseDimensions(dimensions);
      validCombos = await filterCombinations(parsed, llmClient, model);
    }

    // Build doc-level plan data (what each doc needs for generation)
    const docPlans = docs.map((d: any) => ({
      docConvexId: d._id as string,
      docId: d.docId as string,
      title: d.title as string,
      quota: quotas.get(d.docId as string) ?? 0,
      matchedQuestions: matchedByDoc[d.docId as string] ?? [],
    }));

    // Collect global style examples (all matched questions for cross-doc use)
    const globalStyleExamples = Object.values(matchedByDoc)
      .flat()
      .map((m: any) => m.question as string);

    // Pass plan to orchestration (must be JSON-serializable — convert Maps)
    await ctx.runMutation(
      internal.generation.orchestration.savePlanAndEnqueueDocs,
      {
        jobId: args.jobId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        strategyConfig: args.strategyConfig,
        plan: {
          quotas: Object.fromEntries(quotas),
          unmatchedQuestions,
          validCombos,
          globalStyleExamples,
          docPlans,
          preferences: (config.promptPreferences as any) ?? {
            questionTypes: ["factoid", "procedural", "conditional"],
            tone: "professional but accessible",
            focusAreas: "",
          },
          model,
        },
      },
    );

    return {
      phase: "prepared",
      totalDocs: docPlans.filter((d: { quota: number }) => d.quota > 0).length,
    };
  },
});

// ─── Unified Pipeline: Phase 2 — Generate Questions for a Single Document ───

export const generateForDoc = internalAction({
  args: {
    jobId: v.id("generationJobs"),
    datasetId: v.id("datasets"),
    docConvexId: v.id("documents"),
    docId: v.string(),
    quota: v.number(),
    matchedQuestions: v.any(),
    validCombos: v.any(),
    preferences: v.any(),
    globalStyleExamples: v.any(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.quota === 0) return { questionsGenerated: 0 };

    const doc = await ctx.runQuery(internal.crud.documents.getInternal, {
      id: args.docConvexId,
    });
    const llmClient = createLLMClient();

    const rawQuestions = await generateForDocument({
      docId: args.docId,
      docContent: doc.content,
      quota: args.quota,
      matched: args.matchedQuestions ?? [],
      combos: args.validCombos ?? [],
      preferences: args.preferences,
      llmClient,
      model: args.model,
    });

    // Validate citations and build question records
    const validatedQuestions = [];
    let failedCitations = 0;

    for (const q of rawQuestions) {
      const span = findCitationSpan(doc.content, q.citation);
      if (span) {
        validatedQuestions.push({
          queryId: `unified_${args.docId}_q${validatedQuestions.length}`,
          queryText: q.question,
          sourceDocId: args.docId,
          relevantSpans: [
            {
              docId: args.docId,
              start: span.start,
              end: span.end,
              text: span.text,
            },
          ],
          metadata: {
            source: q.source,
            profile: q.profile ?? "",
            citation: span.text,
          },
        });
      } else {
        failedCitations++;
      }
    }

    // Insert questions in batches
    if (validatedQuestions.length > 0) {
      for (
        let i = 0;
        i < validatedQuestions.length;
        i += QUESTION_INSERT_BATCH_SIZE
      ) {
        const batch = validatedQuestions.slice(
          i,
          i + QUESTION_INSERT_BATCH_SIZE,
        );
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch,
        });
      }
    }

    // Report progress
    await ctx.runMutation(
      internal.generation.orchestration.updateDocProgress,
      {
        jobId: args.jobId,
        docName: doc.title,
      },
    );

    return {
      questionsGenerated: validatedQuestions.length,
      failedCitations,
    };
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
