"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { indexSingleDocument } from "./ragActions";
import {
  CallbackRetriever,
  createCorpusFromDocuments,
  createDocument,
  DocumentId,
  PositionAwareChunkId,
  OpenAIEmbedder,
  type PositionAwareChunk,
  type ExperimentResult,
} from "rag-evaluation-system";
import { runLangSmithExperiment } from "rag-evaluation-system/langsmith/experiment-runner";
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

// ─── Single-Action Experiment Runner ───

/**
 * Run an experiment end-to-end:
 * 1. Ensure KB is indexed
 * 2. Ensure dataset is synced to LangSmith
 * 3. Run evaluation via runLangSmithExperiment() with CallbackRetriever
 * 4. Aggregate scores and mark complete
 */
export const runExperiment = internalAction({
  args: {
    jobId: v.id("jobs"),
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.jobs.update, {
        jobId: args.jobId,
        status: "running",
        phase: "initializing",
        progress: { current: 0, total: 4, message: "Starting experiment..." },
      });

      // ── Step 1: Ensure KB is indexed ──
      const isIndexed = await ctx.runQuery(internal.rag.isIndexed, {
        kbId: args.kbId,
      });

      if (!isIndexed) {
        const docs = await ctx.runQuery(internal.documents.listByKbInternal, {
          kbId: args.kbId,
        });

        for (let i = 0; i < docs.length; i++) {
          await ctx.runMutation(internal.jobs.update, {
            jobId: args.jobId,
            phase: "indexing",
            progress: {
              current: i,
              total: docs.length,
              message: `Indexing document ${i + 1}/${docs.length}...`,
            },
          });
          await indexSingleDocument(ctx, docs[i]._id, {});
        }
      }

      // ── Step 2: Ensure dataset is synced to LangSmith ──
      let dataset = await ctx.runQuery(internal.datasets.getInternal, {
        id: args.datasetId,
      });

      if (!dataset.langsmithDatasetId) {
        await ctx.runMutation(internal.jobs.update, {
          jobId: args.jobId,
          phase: "syncing",
          progress: { current: 1, total: 4, message: "Syncing dataset to LangSmith..." },
        });

        await ctx.runAction(internal.langsmithSync.syncDataset, {
          datasetId: args.datasetId,
        });

        // Refresh dataset to get the LangSmith name
        dataset = await ctx.runQuery(internal.datasets.getInternal, {
          id: args.datasetId,
        });
      }

      // ── Step 3: Build corpus and retriever ──
      await ctx.runMutation(internal.jobs.update, {
        jobId: args.jobId,
        phase: "evaluating",
        progress: { current: 2, total: 4, message: "Running evaluation via LangSmith..." },
      });

      const experiment = await ctx.runQuery(internal.experiments.getInternal, {
        id: args.experimentId,
      });

      // Load all documents to build corpus
      const docs = await ctx.runQuery(internal.documents.listByKbInternal, {
        kbId: args.kbId,
      });
      const corpus = createCorpusFromDocuments(
        docs.map((d: any) => createDocument({ id: d.docId, content: d.content })),
      );

      // Create embedder for query embedding
      const retrieverConfig = experiment.retrieverConfig as Record<string, unknown>;
      const embeddingModel =
        (retrieverConfig.embeddingModel as string) ?? "text-embedding-3-small";
      const embedder = createEmbedder(embeddingModel);

      // Build query → questionId lookup for onResult callback
      const questions = await ctx.runQuery(
        internal.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );
      const queryToQuestionId = new Map<string, Id<"questions">>();
      for (const q of questions) {
        queryToQuestionId.set(q.queryText, q._id);
      }

      // Create CallbackRetriever backed by Convex vector search
      const retriever = new CallbackRetriever({
        name: "convex-vector-search",
        retrieveFn: async (query: string, topK: number) => {
          const queryEmbedding = await embedder.embedQuery(query);
          const searchResults = await ctx.vectorSearch(
            "documentChunks",
            "by_embedding",
            {
              vector: queryEmbedding,
              limit: topK,
              filter: (q: any) => q.eq("kbId", args.kbId),
            },
          );

          const chunks = await ctx.runQuery(internal.rag.fetchChunksWithDocs, {
            ids: searchResults.map((r: any) => r._id),
          });

          return chunks.map(
            (c: any): PositionAwareChunk => ({
              id: PositionAwareChunkId(c.chunkId),
              content: c.content,
              metadata: c.metadata ?? {},
              docId: DocumentId(c.docId),
              start: c.start,
              end: c.end,
            }),
          );
        },
      });

      // ── Step 4: Run experiment via LangSmith evaluate() ──
      let resultsCount = 0;

      await runLangSmithExperiment({
        corpus,
        retriever,
        k: experiment.k,
        datasetName: dataset.langsmithDatasetId ?? dataset.name,
        experimentPrefix: experiment.name,
        metadata: {
          experimentId: args.experimentId,
          retrieverConfig: experiment.retrieverConfig,
        },
        onResult: async (result: ExperimentResult) => {
          const questionId = queryToQuestionId.get(result.query);
          if (questionId) {
            await ctx.runMutation(internal.experimentResults.insert, {
              experimentId: args.experimentId,
              questionId,
              retrievedSpans: result.retrievedSpans,
              scores: result.scores,
              metadata: {},
            });
          }
          resultsCount++;
          await ctx.runMutation(internal.jobs.update, {
            jobId: args.jobId,
            progress: {
              current: resultsCount,
              total: questions.length,
              message: `Evaluated ${resultsCount}/${questions.length} questions`,
            },
          });
        },
      });

      // ── Step 5: Aggregate scores ──
      await ctx.runMutation(internal.jobs.update, {
        jobId: args.jobId,
        phase: "aggregating",
        progress: { current: 3, total: 4, message: "Computing average scores..." },
      });

      const results = await ctx.runQuery(
        internal.experimentResults.byExperimentInternal,
        { experimentId: args.experimentId },
      );

      const metricNames = experiment.metricNames;
      const avgScores: Record<string, number> = {};

      for (const name of metricNames) {
        const values = results
          .map((r: any) => (r.scores as Record<string, number>)[name])
          .filter((v: unknown): v is number => typeof v === "number");

        avgScores[name] =
          values.length > 0
            ? values.reduce((a: number, b: number) => a + b, 0) / values.length
            : 0;
      }

      // Update experiment with final scores
      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "completed",
        scores: avgScores,
      });

      await ctx.runMutation(internal.jobs.update, {
        jobId: args.jobId,
        status: "completed",
        phase: "done",
        progress: { current: 4, total: 4, message: "Experiment complete" },
        result: {
          experimentId: args.experimentId,
          scores: avgScores,
          totalQuestions: results.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "failed",
        error: message,
      });
      await ctx.runMutation(internal.jobs.update, {
        jobId: args.jobId,
        status: "failed",
        error: message,
      });
    }
  },
});
