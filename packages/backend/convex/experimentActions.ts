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
  positionAwareChunkToSpan,
  recall,
  precision,
  iou,
  f1,
  type PositionAwareChunk,
  type Corpus,
  type Retriever,
  type Metric,
  type CharacterSpan,
} from "rag-evaluation-system";
import OpenAI from "openai";

// ─── Inlined from eval-lib/src/langsmith/ ───

interface ExperimentResult {
  query: string;
  retrievedSpans: Array<{ docId: string; start: number; end: number; text: string }>;
  scores: Record<string, number>;
}

interface SerializedSpan {
  docId: string;
  start: number;
  end: number;
  text: string;
}

function deserializeSpans(raw: unknown): CharacterSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: SerializedSpan) => ({
    docId: DocumentId(s.docId),
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

function createLangSmithEvaluator(metric: Metric) {
  return (args: {
    outputs?: Record<string, unknown>;
    referenceOutputs?: Record<string, unknown>;
  }) => {
    const retrieved = deserializeSpans(args.outputs?.relevantSpans);
    const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);
    const score = metric.calculate(retrieved, groundTruth);
    return { key: metric.name, score };
  };
}

function createLangSmithEvaluators(metrics: readonly Metric[]) {
  return metrics.map(createLangSmithEvaluator);
}

interface LangSmithExperimentConfig {
  readonly corpus: Corpus;
  readonly retriever: Retriever;
  readonly k: number;
  readonly datasetName: string;
  readonly metrics?: readonly Metric[];
  readonly experimentPrefix?: string;
  readonly metadata?: Record<string, unknown>;
  readonly onResult?: (result: ExperimentResult) => Promise<void>;
}

const DEFAULT_METRICS: readonly Metric[] = [recall, precision, iou, f1];

async function runLangSmithExperiment(config: LangSmithExperimentConfig): Promise<void> {
  const {
    corpus,
    retriever,
    k,
    datasetName,
    experimentPrefix,
    metadata,
    onResult,
  } = config;
  const metrics = config.metrics ?? DEFAULT_METRICS;

  await retriever.init(corpus);

  try {
    const target = async (inputs: { query: string }) => {
      const chunks = await retriever.retrieve(inputs.query, k);
      return {
        relevantSpans: chunks.map((chunk) => {
          const span = positionAwareChunkToSpan(chunk);
          return {
            docId: String(span.docId),
            start: span.start,
            end: span.end,
            text: span.text,
          };
        }),
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangSmith evaluate() accepts both sync and async evaluators
    const evaluators: Array<(...args: any[]) => any> = [...createLangSmithEvaluators(metrics)];

    // When onResult is provided, append a callback evaluator that computes
    // all metrics and fires the callback with the complete result data.
    if (onResult) {
      evaluators.push(async (args: {
        inputs?: Record<string, unknown>;
        outputs?: Record<string, unknown>;
        referenceOutputs?: Record<string, unknown>;
      }) => {
        const query = String(args.inputs?.query ?? "");
        const retrievedSpans = (args.outputs?.relevantSpans ?? []) as ExperimentResult["retrievedSpans"];
        const retrieved = deserializeSpans(args.outputs?.relevantSpans);
        const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);

        const scores: Record<string, number> = {};
        for (const metric of metrics) {
          scores[metric.name] = metric.calculate(retrieved, groundTruth);
        }

        await onResult({ query, retrievedSpans, scores });
        return { key: "_onResultSync", score: 1 };
      });
    }

    const { evaluate } = await import("langsmith/evaluation");

    await evaluate(target, {
      data: datasetName,
      evaluators,
      experimentPrefix: experimentPrefix ?? retriever.name,
      metadata: {
        retriever: retriever.name,
        k,
        corpusSize: corpus.documents.length,
        ...metadata,
      },
    });
  } finally {
    await retriever.cleanup();
  }
}

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

// ─── Orchestrator Action ───

/**
 * Orchestrator: sequential setup, then enqueue a single evaluation WorkPool item.
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

      // ── Step 3: Count questions and guard against empty datasets ──
      const questions = await ctx.runQuery(
        internal.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );

      if (questions.length === 0) {
        await ctx.runMutation(internal.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "completed",
          phase: "done",
          totalQuestions: 0,
        });
        return;
      }

      await ctx.runMutation(internal.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length,
      });

      // ── Step 4: Enqueue single evaluation WorkPool item ──
      await ctx.runMutation(internal.experiments.enqueueExperiment, {
        experimentId: args.experimentId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        indexConfigHash,
        embeddingModel,
        k: experimentK,
        datasetName: dataset.langsmithDatasetId ?? dataset.name,
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

// ─── Single Evaluation Action (wraps LangSmith evaluate()) ───

/**
 * Run the full evaluation via LangSmith's evaluate() function.
 * This is enqueued as a single WorkPool item (no retry).
 * evaluate() handles: creating the experiment, running the target per example,
 * computing metrics, and creating properly linked runs in LangSmith.
 */
export const runEvaluation = internalAction({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number(),
    datasetName: v.string(),
  },
  handler: async (ctx, args) => {
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
    const embedder = createEmbedder(args.embeddingModel);

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
          .filter((c: any) => c.indexConfigHash === args.indexConfigHash)
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

    // Run evaluation via LangSmith evaluate()
    let resultsCount = 0;

    await runLangSmithExperiment({
      corpus,
      retriever,
      k: args.k,
      datasetName: args.datasetName,
      experimentPrefix: experiment.name,
      metadata: {
        experimentId: args.experimentId,
        retrieverConfig: experiment.retrieverConfig,
        retrieverId: experiment.retrieverId,
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
        await ctx.runMutation(internal.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "running",
          phase: "evaluating",
          processedQuestions: resultsCount,
        });
      },
    });

    // Aggregate scores after evaluate() completes
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

    // Mark experiment complete with aggregated scores
    await ctx.runMutation(internal.experiments.updateStatus, {
      experimentId: args.experimentId,
      status: "completed",
      scores: avgScores,
      phase: "done",
    });
  },
});
