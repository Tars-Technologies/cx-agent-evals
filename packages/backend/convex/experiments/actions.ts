"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  CallbackRetriever,
  computeIndexConfigHash,
  createCorpusFromDocuments,
  createDocument,
  PositionAwareChunkId,
  DocumentId,
  type PositionAwareChunk,
  type ScoredChunk,
} from "rag-evaluation-system";
import {
  BM25SearchIndex,
  weightedScoreFusion,
  reciprocalRankFusion,
} from "rag-evaluation-system/pipeline/internals";
import {
  runLangSmithExperiment,
  type LangSmithExperimentConfig,
} from "rag-evaluation-system/langsmith";
import type { ExperimentResult } from "rag-evaluation-system/shared";
import { createEmbedder } from "rag-evaluation-system/llm";
import { vectorSearchWithFilter } from "../lib/vectorSearch";
import type { ActionCtx } from "../_generated/server";

// ─── Helpers: search-strategy dispatch ───

interface SearchConfig {
  strategy: "dense" | "bm25" | "hybrid";
  k1?: number;
  b?: number;
  denseWeight?: number;
  sparseWeight?: number;
  fusionMethod?: "weighted" | "rrf";
  rrfK?: number;
  candidateMultiplier?: number;
}

/** Extract search config from a retriever/experiment config object. */
function resolveSearchConfig(retrieverConfig: Record<string, any>): SearchConfig {
  const search = (retrieverConfig.search ?? {}) as Record<string, any>;
  return {
    strategy: (search.strategy as SearchConfig["strategy"]) ?? "dense",
    k1: search.k1 as number | undefined,
    b: search.b as number | undefined,
    denseWeight: search.denseWeight as number | undefined,
    sparseWeight: search.sparseWeight as number | undefined,
    fusionMethod: search.fusionMethod as "weighted" | "rrf" | undefined,
    rrfK: search.rrfK as number | undefined,
    candidateMultiplier: search.candidateMultiplier as number | undefined,
  };
}

/** Paginate through all chunks for a (kbId, indexConfigHash). */
async function loadAllChunks(
  ctx: ActionCtx,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
): Promise<Array<{
  chunkId: string;
  content: string;
  docId: string;
  start: number;
  end: number;
  metadata: Record<string, unknown>;
}>> {
  const all: Array<{
    chunkId: string;
    content: string;
    docId: string;
    start: number;
    end: number;
    metadata: Record<string, unknown>;
  }> = [];
  let cursor: string | null = null;
  let done = false;
  while (!done) {
    const page: any = await ctx.runQuery(
      internal.retrieval.chunks.getChunksByKbConfigPage,
      { kbId, indexConfigHash, cursor },
    );
    all.push(...page.chunks);
    done = page.isDone;
    cursor = page.continueCursor;
  }
  return all;
}

/** Convert raw DB chunks to PositionAwareChunk[], deduplicating by chunkId. */
function toPositionAwareChunks(
  raw: Array<{ chunkId: string; content: string; docId: string; start: number; end: number; metadata: Record<string, unknown> }>,
): PositionAwareChunk[] {
  const seen = new Set<string>();
  const result: PositionAwareChunk[] = [];
  for (const c of raw) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    result.push({
      id: PositionAwareChunkId(c.chunkId),
      content: c.content,
      docId: DocumentId(c.docId),
      start: c.start,
      end: c.end,
      metadata: c.metadata,
    });
  }
  return result;
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
      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "initializing",
      });

      const experiment = await ctx.runQuery(internal.experiments.orchestration.getInternal, {
        id: args.experimentId,
      });

      let indexConfigHash: string;
      let embeddingModel: string;
      let experimentK: number;

      if (experiment.retrieverId) {
        // ── Retriever path: load config, skip indexing ──
        const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, {
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
          internal.retrieval.indexing.startIndexing,
          {
            orgId: experiment.orgId,
            kbId: args.kbId,
            indexConfigHash,
            indexConfig,
            createdBy: experiment.createdBy,
          },
        );

        if (!indexResult.alreadyCompleted) {
          await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
            experimentId: args.experimentId,
            status: "running",
            phase: "indexing",
          });

          let indexingDone = false;
          while (!indexingDone) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const indexJob = await ctx.runQuery(
              internal.retrieval.indexing.getJobInternal,
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

      // ── Step 2: Load questions (needed for staleness check + guard) ──
      const allQuestions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );
      // Skip questions with no ground truth spans — they inflate recall
      // and drag down precision, making retriever metrics meaningless.
      const questions = allQuestions.filter(
        (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0,
      );

      // ── Step 3: Ensure dataset is synced to LangSmith ──
      let dataset = await ctx.runQuery(internal.crud.datasets.getInternal, {
        id: args.datasetId,
      });

      // Detect stale LangSmith dataset: if the dataset's total question
      // count differs from the filtered count (questions with ground truth),
      // the LangSmith dataset was synced before the ground-truth filter was
      // added and contains extra examples that waste evaluation time.
      const needsResync =
        !dataset.langsmithDatasetId ||
        (dataset.questionCount != null && dataset.questionCount !== questions.length);

      if (needsResync) {
        if (dataset.langsmithDatasetId) {
          await ctx.runMutation(internal.crud.datasets.clearLangsmithSync, {
            datasetId: args.datasetId,
          });
        }

        await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
          experimentId: args.experimentId,
          status: "running",
          phase: "syncing",
        });

        await ctx.runAction(internal.langsmith.sync.syncDataset, {
          datasetId: args.datasetId,
        });

        dataset = await ctx.runQuery(internal.crud.datasets.getInternal, {
          id: args.datasetId,
        });
      }

      if (questions.length === 0) {
        await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
          experimentId: args.experimentId,
          status: "completed",
          phase: "done",
          totalQuestions: 0,
        });
        return;
      }

      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length,
      });

      // ── Step 4: Enqueue single evaluation WorkPool item ──
      await ctx.runMutation(internal.experiments.orchestration.enqueueExperiment, {
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
      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
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
    const experiment = await ctx.runQuery(internal.experiments.orchestration.getInternal, {
      id: args.experimentId,
    });

    // Load all documents to build corpus
    const docs = await ctx.runQuery(internal.crud.documents.listByKbInternal, {
      kbId: args.kbId,
    });
    const corpus = createCorpusFromDocuments(
      docs.map((d: any) => createDocument({ id: d.docId, content: d.content })),
    );

    // Create embedder for query embedding
    const embedder = createEmbedder(args.embeddingModel);

    // Build query → questionId lookup for onResult callback.
    // Only include questions with ground truth spans so retriever
    // metrics are not distorted by unanswerable questions.
    const allQuestions = await ctx.runQuery(
      internal.crud.questions.byDatasetInternal,
      { datasetId: args.datasetId },
    );
    const questions = allQuestions.filter(
      (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0,
    );
    const queryToQuestionId = new Map<string, Id<"questions">>();
    for (const q of questions) {
      queryToQuestionId.set(q.queryText, q._id);
    }

    // Resolve index strategy and search config from retriever/experiment config.
    let indexStrategy = "plain";
    let retrieverConfigObj: Record<string, any> = {};
    if (experiment.retrieverId) {
      const ret = await ctx.runQuery(internal.crud.retrievers.getInternal, {
        id: experiment.retrieverId,
      });
      retrieverConfigObj = (ret.retrieverConfig ?? {}) as Record<string, any>;
    } else {
      retrieverConfigObj = (experiment.retrieverConfig ?? {}) as Record<string, any>;
    }
    const idxSettings = (retrieverConfigObj.index ?? {}) as Record<string, any>;
    indexStrategy = (idxSettings.strategy as string) ?? "plain";

    const searchConfig = resolveSearchConfig(retrieverConfigObj);

    // ── Build retriever based on search strategy ──
    let retriever: CallbackRetriever;
    let cleanupFn: (() => void) | undefined;

    if (searchConfig.strategy === "bm25") {
      // BM25: load all chunks, build in-memory inverted index, no embeddings
      const rawChunks = await loadAllChunks(ctx, args.kbId, args.indexConfigHash);
      const paChunks = toPositionAwareChunks(rawChunks);
      const bm25 = new BM25SearchIndex({ k1: searchConfig.k1, b: searchConfig.b });
      bm25.build(paChunks);
      cleanupFn = () => bm25.clear();

      retriever = new CallbackRetriever({
        name: "convex-bm25-search",
        retrieveFn: async (query: string, topK: number) => {
          return [...bm25.search(query, topK)];
        },
        cleanupFn: async () => bm25.clear(),
      });
    } else if (searchConfig.strategy === "hybrid") {
      // Hybrid: BM25 in-memory + Convex vector search, fused
      const rawChunks = await loadAllChunks(ctx, args.kbId, args.indexConfigHash);
      const paChunks = toPositionAwareChunks(rawChunks);
      const bm25 = new BM25SearchIndex({ k1: searchConfig.k1, b: searchConfig.b });
      bm25.build(paChunks);
      cleanupFn = () => bm25.clear();

      const candidateMultiplier = searchConfig.candidateMultiplier ?? 4;
      const denseWeight = searchConfig.denseWeight ?? 0.7;
      const sparseWeight = searchConfig.sparseWeight ?? 0.3;

      retriever = new CallbackRetriever({
        name: "convex-hybrid-search",
        retrieveFn: async (query: string, topK: number) => {
          const candidateK = topK * candidateMultiplier;

          // Dense component: embed query → Convex vector search
          const queryEmbedding = await embedder.embedQuery(query);
          const { chunks: denseRaw, scoreMap } = await vectorSearchWithFilter(ctx, {
            queryEmbedding,
            kbId: args.kbId,
            indexConfigHash: args.indexConfigHash,
            topK: candidateK,
            indexStrategy,
          });
          const denseResults: ScoredChunk[] = denseRaw.map((c: any) => ({
            chunk: {
              id: PositionAwareChunkId(c.chunkId),
              content: c.content,
              docId: DocumentId(c.docId),
              start: c.start,
              end: c.end,
              metadata: c.metadata ?? {},
            },
            score: scoreMap.get(c._id.toString()) ?? 0,
          }));

          // Sparse component: BM25 in-memory
          const sparseResults: ScoredChunk[] = [
            ...bm25.searchWithScores(query, candidateK),
          ];

          // Fuse results
          const fused =
            searchConfig.fusionMethod === "rrf"
              ? reciprocalRankFusion({ denseResults, sparseResults, k: searchConfig.rrfK })
              : weightedScoreFusion({ denseResults, sparseResults, denseWeight, sparseWeight });

          return fused.slice(0, topK).map(({ chunk }) => chunk);
        },
        cleanupFn: async () => bm25.clear(),
      });
    } else {
      // Dense (default): embed query → Convex vector search
      retriever = new CallbackRetriever({
        name: "convex-vector-search",
        retrieveFn: async (query: string, topK: number) => {
          const queryEmbedding = await embedder.embedQuery(query);
          const { chunks: filtered } = await vectorSearchWithFilter(ctx, {
            queryEmbedding,
            kbId: args.kbId,
            indexConfigHash: args.indexConfigHash,
            topK,
            indexStrategy,
          });

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
    }

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
          await ctx.runMutation(internal.experiments.results.insert, {
            experimentId: args.experimentId,
            questionId,
            retrievedSpans: result.retrievedSpans,
            scores: result.scores,
            metadata: {},
          });
        }
        resultsCount++;
        await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
          experimentId: args.experimentId,
          status: "running",
          phase: "evaluating",
          processedQuestions: resultsCount,
        });
      },
    });

    // Aggregate scores after evaluate() completes
    const results = await ctx.runQuery(
      internal.experiments.results.byExperimentInternal,
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
    await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
      experimentId: args.experimentId,
      status: "completed",
      scores: avgScores,
      phase: "done",
    });
  },
});
