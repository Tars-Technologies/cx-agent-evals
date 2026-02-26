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

      // ── Step 0: Load experiment and resolve retriever config ──
      const experiment = await ctx.runQuery(internal.experiments.getInternal, {
        id: args.experimentId,
      });

      let indexConfigHash: string;
      let embeddingModel: string;
      let experimentK: number;

      if (experiment.retrieverId) {
        // ── New path: load config from retrievers table, skip indexing ──
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
        // ── Legacy path: inline retrieverConfig, trigger indexing ──
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

        // Ensure KB is indexed via indexing service
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
          await ctx.runMutation(internal.jobs.update, {
            jobId: args.jobId,
            phase: "indexing",
            progress: { current: 0, total: 1, message: "Indexing knowledge base..." },
          });

          let indexingDone = false;
          while (!indexingDone) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const indexJob = await ctx.runQuery(
              internal.indexing.getJobInternal,
              { jobId: indexResult.jobId },
            );
            if (!indexJob) throw new Error("Indexing job disappeared");

            await ctx.runMutation(internal.jobs.update, {
              jobId: args.jobId,
              phase: "indexing",
              progress: {
                current: indexJob.processedDocs,
                total: indexJob.totalDocs,
                message: `Indexing ${indexJob.processedDocs}/${indexJob.totalDocs} documents...`,
              },
            });

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

      // Load all documents to build corpus
      const docs = await ctx.runQuery(internal.documents.listByKbInternal, {
        kbId: args.kbId,
      });
      const corpus = createCorpusFromDocuments(
        docs.map((d: any) => createDocument({ id: d.docId, content: d.content })),
      );

      // Create embedder for query embedding
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
          // vectorSearch filter only supports eq and or — no AND.
          // Filter by kbId in vector search, post-filter by indexConfigHash.
          const vectorLimit = Math.min(topK * 4, 256);
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
            .filter((c: any) => c.indexConfigHash === indexConfigHash)
            .slice(0, topK);

          return filtered.map(
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
        k: experimentK,
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
