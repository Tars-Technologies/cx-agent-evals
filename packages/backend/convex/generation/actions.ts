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

    // Truncate arrays to stay within Convex's 8192 array element limit
    const MAX_STYLE_EXAMPLES = 50;
    const MAX_COMBOS = 200;
    const MAX_UNMATCHED = 500;

    // Build doc-level plan data — limit matched questions to doc's quota
    const docPlans = docs.map((d: any) => {
      const docQuota = quotas.get(d.docId as string) ?? 0;
      const matched = matchedByDoc[d.docId as string] ?? [];
      return {
        docConvexId: d._id as string,
        docId: d.docId as string,
        title: d.title as string,
        quota: docQuota,
        matchedQuestions: matched.slice(0, Math.max(docQuota, 10)),
      };
    });

    // Collect global style examples (capped)
    const globalStyleExamples = Object.values(matchedByDoc)
      .flat()
      .map((m: any) => m.question as string)
      .slice(0, MAX_STYLE_EXAMPLES);

    const truncatedCombos = validCombos.slice(0, MAX_COMBOS);
    const truncatedUnmatched = unmatchedQuestions.slice(0, MAX_UNMATCHED);

    const preferences = (config.promptPreferences as any) ?? {
      questionTypes: ["factoid", "procedural", "conditional"],
      tone: "professional but accessible",
      focusAreas: "",
    };

    // Step 1: Store shared plan data on the job record (avoids duplicating
    // large arrays in every per-doc action call)
    await ctx.runMutation(
      internal.generation.orchestration.storeGenerationPlan,
      {
        jobId: args.jobId,
        sharedPlan: {
          validCombos: truncatedCombos,
          globalStyleExamples,
          preferences,
          model,
        },
      },
    );

    // Step 2: Enqueue per-doc actions with only doc-specific data
    await ctx.runMutation(
      internal.generation.orchestration.savePlanAndEnqueueDocs,
      {
        jobId: args.jobId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        strategyConfig: args.strategyConfig,
        plan: {
          quotas: Object.fromEntries(quotas),
          unmatchedQuestions: truncatedUnmatched,
          docPlans,
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
    model: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.quota === 0) return { questionsGenerated: 0, failedCitations: 0, missedQuestions: 0 };

    // Read shared plan data from job record (stored once, not passed per-doc)
    const job = await ctx.runQuery(
      internal.generation.orchestration.getJobInternal,
      { jobId: args.jobId },
    );
    const sharedPlan = (job?.generationPlan ?? {}) as {
      validCombos?: Record<string, string>[];
      globalStyleExamples?: string[];
      preferences?: any;
    };

    const doc = await ctx.runQuery(internal.crud.documents.getInternal, {
      id: args.docConvexId,
    });
    const llmClient = createLLMClient();

    // Determine scenario for retry eligibility
    const matchedCount = (args.matchedQuestions ?? []).length;
    const isScenario1 = matchedCount >= args.quota;

    const allValidated: Array<{
      queryId: string;
      queryText: string;
      sourceDocId: string;
      relevantSpans: Array<{ docId: string; start: number; end: number; text: string }>;
      metadata: Record<string, unknown>;
      source: string | undefined;
    }> = [];
    let totalFailedCitations = 0;
    const MAX_RETRIES = 4;

    for (let round = 0; round <= MAX_RETRIES; round++) {
      const remaining = args.quota - allValidated.length;
      if (remaining <= 0) break;

      // Skip retry loop for scenario 1 (direct reuse only — fixed question set)
      if (round > 0 && isScenario1) break;
      // For retries, request shortfall + 2 buffer
      if (round > 0 && remaining <= 0) break;

      const requestCount = round === 0 ? args.quota : remaining + 2;
      const excludeQuestions = round === 0
        ? undefined
        : allValidated.map((q) => q.queryText);

      const rawQuestions = await generateForDocument({
        docId: args.docId,
        docContent: doc.content,
        quota: requestCount,
        matched: args.matchedQuestions ?? [],
        combos: sharedPlan.validCombos ?? [],
        preferences: sharedPlan.preferences ?? {
          questionTypes: ["factoid", "procedural", "conditional"],
          tone: "professional but accessible",
          focusAreas: "",
        },
        llmClient,
        model: args.model,
        excludeQuestions,
      });

      // Validate citations
      for (const q of rawQuestions) {
        if (allValidated.length >= args.quota) break;

        const span = findCitationSpan(doc.content, q.citation);
        if (span) {
          allValidated.push({
            queryId: `unified_${args.docId}_q${allValidated.length}`,
            queryText: q.question,
            sourceDocId: args.docId,
            relevantSpans: [
              { docId: args.docId, start: span.start, end: span.end, text: span.text },
            ],
            metadata: {
              source: q.source,
              profile: q.profile ?? "",
              citation: span.text,
            },
            source: q.source === "real-world" ? "real-world" : undefined,
          });
        } else {
          totalFailedCitations++;
        }
      }
    }

    const missedQuestions = args.quota - allValidated.length;

    // Insert questions in batches
    if (allValidated.length > 0) {
      for (let i = 0; i < allValidated.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = allValidated.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch,
        });
      }
    }

    // Report progress (once, after all retries)
    await ctx.runMutation(
      internal.generation.orchestration.updateDocProgress,
      { jobId: args.jobId, docName: doc.title },
    );

    return {
      questionsGenerated: allValidated.length,
      failedCitations: totalFailedCitations,
      missedQuestions: missedQuestions > 0 ? missedQuestions : 0,
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
