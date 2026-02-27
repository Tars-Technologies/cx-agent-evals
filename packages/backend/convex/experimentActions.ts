"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  CallbackRetriever,
  computeIndexConfigHash,
  createCorpusFromDocuments,
  createDocument,
  DocumentId,
  PositionAwareChunkId,
  OpenAIEmbedder,
  type PositionAwareChunk,
  recall,
  precision,
  iou,
  f1,
} from "rag-evaluation-system";
import {
  createLangSmithExperiment,
  logLangSmithResult,
} from "rag-evaluation-system/langsmith";
import OpenAI from "openai";

// ─── Helpers ───

function createEmbedder(model?: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey });
  return new OpenAIEmbedder({
    model: model ?? "text-embedding-3-small",
    client: openai,
  });
}

const METRICS = { recall, precision, iou, f1 };

// ─── Orchestrator Action ───

/**
 * Orchestrator: sequential setup, then fan-out per-question evaluation.
 * Supports two paths:
 *   - Retriever path: experiment.retrieverId → skip indexing
 *   - Legacy path: experiment.retrieverConfig → trigger indexing
 */
export const runExperiment = internalAction({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    try {
      // ── Step 0: Initialize ──
      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "initializing",
      });

      const experiment = await ctx.runQuery(internal.experiments.getInternal, {
        id: args.experimentId,
      });

      let indexConfigHash: string;
      let embeddingModel: string;
      let experimentK: number;

      if (experiment.retrieverId) {
        // ── Retriever path: load config, skip indexing ──
        const retriever = await ctx.runQuery(internal.retrievers.getInternal, {
          id: experiment.retrieverId,
        });
        if (retriever.status !== "ready") {
          throw new Error(
            `Retriever is not ready (status: ${retriever.status}). Index the KB first.`,
          );
        }

        indexConfigHash = retriever.indexConfigHash;
        experimentK = retriever.defaultK;

        const retConfig = retriever.retrieverConfig as Record<string, any>;
        const idxSettings = (retConfig.index ?? {}) as Record<string, any>;
        embeddingModel =
          (idxSettings.embeddingModel as string) ?? "text-embedding-3-small";
      } else {
        // ── Legacy path: compute hash, trigger indexing ──
        const retrieverConfig = experiment.retrieverConfig as Record<string, any>;
        const indexSettings = (retrieverConfig.index ?? {}) as Record<string, any>;
        embeddingModel =
          (indexSettings.embeddingModel as string) ?? "text-embedding-3-small";
        experimentK = (experiment.k as number) ?? 5;

        const indexConfig = {
          strategy: "plain" as const,
          chunkSize: (indexSettings.chunkSize as number) ?? 1000,
          chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
          separators: indexSettings.separators as string[] | undefined,
          embeddingModel,
        };
        indexConfigHash = computeIndexConfigHash({
          name: retrieverConfig.name ?? "experiment",
          index: indexConfig,
        });

        const indexResult = await ctx.runMutation(
          internal.indexing.startIndexing,
          {
            orgId: experiment.orgId,
            kbId: args.kbId,
            indexConfigHash,
            indexConfig,
            createdBy: experiment.createdBy,
          },
        );

        if (!indexResult.alreadyCompleted) {
          await ctx.runMutation(internal.experiments.updateStatus, {
            experimentId: args.experimentId,
            status: "running",
            phase: "indexing",
          });

          let indexingDone = false;
          while (!indexingDone) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const indexJob = await ctx.runQuery(
              internal.indexing.getJobInternal,
              { jobId: indexResult.jobId },
            );
            if (!indexJob) throw new Error("Indexing job disappeared");

            if (
              indexJob.status === "completed" ||
              indexJob.status === "completed_with_errors"
            ) {
              indexingDone = true;
            } else if (indexJob.status === "failed") {
              throw new Error("Indexing failed: " + (indexJob.error ?? "unknown"));
            } else if (indexJob.status === "canceled") {
              throw new Error("Indexing was canceled");
            }
          }
        }
      }

      // ── Step 2: Ensure dataset is synced to LangSmith ──
      let dataset = await ctx.runQuery(internal.datasets.getInternal, {
        id: args.datasetId,
      });

      if (!dataset.langsmithDatasetId) {
        await ctx.runMutation(internal.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "running",
          phase: "syncing",
        });

        await ctx.runAction(internal.langsmithSync.syncDataset, {
          datasetId: args.datasetId,
        });

        dataset = await ctx.runQuery(internal.datasets.getInternal, {
          id: args.datasetId,
        });
      }

      // ── Step 3: Create LangSmith experiment ──
      let langsmithExperimentId: string | undefined;
      let langsmithUrl: string | undefined;

      try {
        const lsResult = await createLangSmithExperiment({
          datasetName: dataset.langsmithDatasetId ?? dataset.name,
          experimentName: experiment.name,
          metadata: {
            experimentId: args.experimentId,
            retrieverConfig: experiment.retrieverConfig,
            retrieverId: experiment.retrieverId,
          },
        });
        langsmithExperimentId = lsResult.experimentId;
        langsmithUrl = lsResult.experimentUrl;
      } catch (error) {
        // LangSmith experiment creation is non-fatal — continue without it
        console.error("Failed to create LangSmith experiment:", error);
      }

      // ── Step 4: Enqueue per-question evaluation ──
      const questions = await ctx.runQuery(
        internal.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );

      // C2: Guard against empty datasets
      if (questions.length === 0) {
        await ctx.runMutation(internal.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "completed",
          phase: "done",
          totalQuestions: 0,
          langsmithExperimentId,
          langsmithUrl,
        });
        return;
      }

      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length,
        langsmithExperimentId,
        langsmithUrl,
      });

      // Enqueue evaluation items via mutation (pool.enqueueAction needs mutation ctx)
      await ctx.runMutation(internal.experiments.enqueueEvaluations, {
        experimentId: args.experimentId,
        kbId: args.kbId,
        indexConfigHash,
        embeddingModel,
        k: experimentK,
        langsmithExperimentId,
        questionIds: questions.map((q: any) => q._id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "failed",
        error: message,
      });
    }
  },
});


// ─── Per-Question Evaluation Action ───

export const evaluateQuestion = internalAction({
  args: {
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number(),
    langsmithExperimentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Load question
    const question = await ctx.runQuery(internal.questions.getInternal, {
      id: args.questionId,
    });

    // Embed query
    const embedder = createEmbedder(args.embeddingModel);
    const queryEmbedding = await embedder.embedQuery(question.queryText);

    // Vector search
    const vectorLimit = Math.min(args.k * 4, 256);
    const searchResults = await ctx.vectorSearch(
      "documentChunks",
      "by_embedding",
      {
        vector: queryEmbedding,
        limit: vectorLimit,
        filter: (q: any) => q.eq("kbId", args.kbId),
      },
    );

    const chunks = await ctx.runQuery(internal.rag.fetchChunksWithDocs, {
      ids: searchResults.map((r: any) => r._id),
    });

    // Post-filter by indexConfigHash and take top-K
    const filtered = chunks
      .filter((c: any) => c.indexConfigHash === args.indexConfigHash)
      .slice(0, args.k);

    // Build retrieved spans
    const retrievedSpans = filtered.map((c: any) => ({
      docId: c.docId as string,
      start: c.start as number,
      end: c.end as number,
      text: c.content as string,
    }));

    // Compute metrics
    const groundTruthSpans = question.relevantSpans ?? [];

    // Convert to CharacterSpan format metrics expect
    const retrieved = retrievedSpans.map((s) => ({
      docId: s.docId as any,
      start: s.start,
      end: s.end,
      text: s.text,
    }));
    const groundTruth = groundTruthSpans.map((s: any) => ({
      docId: s.docId as any,
      start: s.start as number,
      end: s.end as number,
      text: (s.text as string) ?? "",
    }));

    const scores: Record<string, number> = {};
    for (const [name, metric] of Object.entries(METRICS)) {
      scores[name] = metric.calculate(retrieved, groundTruth);
    }

    // Insert result
    await ctx.runMutation(internal.experimentResults.insert, {
      experimentId: args.experimentId,
      questionId: args.questionId,
      retrievedSpans,
      scores,
      metadata: {},
    });

    // Log to LangSmith (non-fatal)
    if (args.langsmithExperimentId) {
      try {
        await logLangSmithResult({
          experimentId: args.langsmithExperimentId,
          // I5: Link to LangSmith dataset example for proper experiment correlation
          datasetExampleId: (question as any).langsmithExampleId ?? undefined,
          input: { query: question.queryText },
          output: { relevantSpans: retrievedSpans },
          referenceOutput: { relevantSpans: groundTruthSpans },
          scores,
        });
      } catch (error) {
        console.error("Failed to log to LangSmith:", error);
      }
    }

    return { scores };
  },
});
