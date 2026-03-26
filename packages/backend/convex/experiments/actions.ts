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
  rrfFuseMultiple,
  assignRankScores,
  applyThresholdFilter,
  applyDedup,
  applyMmr,
  applyExpandContext,
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  parseVariants,
} from "rag-evaluation-system/pipeline/internals";
import { OpenAIPipelineLLM } from "rag-evaluation-system/pipeline/llm-openai";
import type { PipelineLLM } from "rag-evaluation-system";
import type { Reranker } from "rag-evaluation-system";
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

// ─── Helpers: query expansion ───

interface QueryConfig {
  strategy: "identity" | "hyde" | "multi-query" | "step-back" | "rewrite";
  hydePrompt?: string;
  numHypotheticalDocs?: number;
  numQueries?: number;
  generationPrompt?: string;
  stepBackPrompt?: string;
  includeOriginal?: boolean;
  rewritePrompt?: string;
}

interface RefinementStep {
  type: "rerank" | "threshold" | "dedup" | "mmr" | "expand-context";
  minScore?: number;
  method?: "exact" | "overlap";
  overlapThreshold?: number;
  lambda?: number;
  windowChars?: number;
}

function resolveQueryConfig(retrieverConfig: Record<string, any>): QueryConfig {
  const q = (retrieverConfig.query ?? {}) as Record<string, any>;
  return {
    strategy: (q.strategy as QueryConfig["strategy"]) ?? "identity",
    hydePrompt: q.hydePrompt as string | undefined,
    numHypotheticalDocs: q.numHypotheticalDocs as number | undefined,
    numQueries: q.numQueries as number | undefined,
    generationPrompt: q.generationPrompt as string | undefined,
    stepBackPrompt: q.stepBackPrompt as string | undefined,
    includeOriginal: q.includeOriginal as boolean | undefined,
    rewritePrompt: q.rewritePrompt as string | undefined,
  };
}

function resolveRefinementConfig(retrieverConfig: Record<string, any>): RefinementStep[] {
  const r = retrieverConfig.refinement;
  if (!Array.isArray(r)) return [];
  return r.map((step: any) => ({
    type: step.type as RefinementStep["type"],
    minScore: step.minScore as number | undefined,
    method: step.method as "exact" | "overlap" | undefined,
    overlapThreshold: step.overlapThreshold as number | undefined,
    lambda: step.lambda as number | undefined,
    windowChars: step.windowChars as number | undefined,
  }));
}

/** Expand a query using the configured strategy. */
async function processQuery(
  query: string,
  config: QueryConfig,
  llm?: PipelineLLM,
): Promise<string[]> {
  switch (config.strategy) {
    case "identity":
      return [query];
    case "hyde": {
      if (!llm) return [query];
      const prompt = config.hydePrompt ?? DEFAULT_HYDE_PROMPT;
      const n = config.numHypotheticalDocs ?? 1;
      if (n === 1) return [await llm.complete(prompt + query)];
      return Promise.all(
        Array.from({ length: n }, () => llm.complete(prompt + query)),
      );
    }
    case "multi-query": {
      if (!llm) return [query];
      const n = config.numQueries ?? 3;
      const prompt = (config.generationPrompt ?? DEFAULT_MULTI_QUERY_PROMPT).replace(
        "{n}",
        String(n),
      );
      const variants = await llm.complete(prompt + query);
      return parseVariants(variants, n);
    }
    case "step-back": {
      if (!llm) return [query];
      const prompt = config.stepBackPrompt ?? DEFAULT_STEP_BACK_PROMPT;
      const abstract = await llm.complete(prompt + query);
      return config.includeOriginal !== false ? [query, abstract] : [abstract];
    }
    case "rewrite": {
      if (!llm) return [query];
      const prompt = config.rewritePrompt ?? DEFAULT_REWRITE_PROMPT;
      return [await llm.complete(prompt + query)];
    }
  }
}

/** Apply refinement steps in sequence. */
async function applyRefinementChain(
  originalQuery: string,
  results: ScoredChunk[],
  steps: RefinementStep[],
  k: number,
  corpus: ReturnType<typeof createCorpusFromDocuments>,
  reranker?: Reranker,
): Promise<ScoredChunk[]> {
  let current = results;
  for (const step of steps) {
    switch (step.type) {
      case "rerank": {
        if (!reranker) {
          console.warn("[Refinement] Skipping rerank — no reranker available (set CO_API_KEY)");
          break;
        }
        const chunks = current.map(({ chunk }) => chunk);
        const reranked = await reranker.rerank(originalQuery, chunks, k);
        current = assignRankScores(reranked);
        break;
      }
      case "threshold":
        current = applyThresholdFilter(current, step.minScore ?? 0);
        break;
      case "dedup":
        current = applyDedup(current, step.method ?? "overlap", step.overlapThreshold ?? 0.5);
        break;
      case "mmr":
        current = applyMmr(current, k, step.lambda ?? 0.7);
        break;
      case "expand-context":
        current = applyExpandContext(current, corpus, step.windowChars ?? 500);
        break;
    }
  }
  return current;
}

/** Try to create a Cohere reranker. Returns undefined if not available. */
async function tryCreateReranker(): Promise<Reranker | undefined> {
  try {
    const { CohereReranker } = await import("rag-evaluation-system/rerankers/cohere");
    return await CohereReranker.create();
  } catch {
    console.warn("[Reranker] Cohere reranker not available — rerank steps will be skipped");
    return undefined;
  }
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
    const queryConfig = resolveQueryConfig(retrieverConfigObj);
    const refinementSteps = resolveRefinementConfig(retrieverConfigObj);

    // ── Create optional LLM for query expansion ──
    const needsLLM = ["hyde", "multi-query", "step-back", "rewrite"].includes(queryConfig.strategy);
    let llm: PipelineLLM | undefined;
    if (needsLLM) {
      llm = await OpenAIPipelineLLM.create({ model: "gpt-4o-mini" });
    }

    // ── Create optional reranker ──
    const needsReranker = refinementSteps.some((s) => s.type === "rerank");
    let reranker: Reranker | undefined;
    if (needsReranker) {
      reranker = await tryCreateReranker();
    }

    // ── Build search function based on strategy ──
    let bm25Cleanup: (() => void) | undefined;

    // Helper: convert raw Convex chunks to ScoredChunk[]
    const convexToScored = (raw: any[], scoreMap: Map<string, number>): ScoredChunk[] =>
      raw.map((c: any) => ({
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

    // Build the doSearch function that returns ScoredChunk[]
    let doSearch: (q: string, topK: number) => Promise<ScoredChunk[]>;

    if (searchConfig.strategy === "bm25") {
      const rawChunks = await loadAllChunks(ctx, args.kbId, args.indexConfigHash);
      const paChunks = toPositionAwareChunks(rawChunks);
      const bm25 = new BM25SearchIndex({ k1: searchConfig.k1, b: searchConfig.b });
      bm25.build(paChunks);
      bm25Cleanup = () => bm25.clear();

      doSearch = async (q: string, topK: number) => {
        return [...bm25.searchWithScores(q, topK)];
      };
    } else if (searchConfig.strategy === "hybrid") {
      const rawChunks = await loadAllChunks(ctx, args.kbId, args.indexConfigHash);
      const paChunks = toPositionAwareChunks(rawChunks);
      const bm25 = new BM25SearchIndex({ k1: searchConfig.k1, b: searchConfig.b });
      bm25.build(paChunks);
      bm25Cleanup = () => bm25.clear();

      const candidateMultiplier = searchConfig.candidateMultiplier ?? 4;
      const denseWeight = searchConfig.denseWeight ?? 0.7;
      const sparseWeight = searchConfig.sparseWeight ?? 0.3;

      doSearch = async (q: string, topK: number) => {
        const candidateK = topK * candidateMultiplier;
        const queryEmbedding = await embedder.embedQuery(q);
        const { chunks: denseRaw, scoreMap } = await vectorSearchWithFilter(ctx, {
          queryEmbedding, kbId: args.kbId, indexConfigHash: args.indexConfigHash,
          topK: candidateK, indexStrategy,
        });
        const denseResults = convexToScored(denseRaw, scoreMap);
        const sparseResults: ScoredChunk[] = [...bm25.searchWithScores(q, candidateK)];

        const fused =
          searchConfig.fusionMethod === "rrf"
            ? reciprocalRankFusion({ denseResults, sparseResults, k: searchConfig.rrfK })
            : weightedScoreFusion({ denseResults, sparseResults, denseWeight, sparseWeight });

        return fused.slice(0, topK);
      };
    } else {
      doSearch = async (q: string, topK: number) => {
        const queryEmbedding = await embedder.embedQuery(q);
        const { chunks: filtered, scoreMap } = await vectorSearchWithFilter(ctx, {
          queryEmbedding, kbId: args.kbId, indexConfigHash: args.indexConfigHash,
          topK, indexStrategy,
        });
        return convexToScored(filtered, scoreMap);
      };
    }

    // ── Build retriever with full pipeline: query → search → refinement ──
    const retriever = new CallbackRetriever({
      name: `convex-${searchConfig.strategy}-search`,
      retrieveFn: async (originalQuery: string, topK: number) => {
        // QUERY stage: expand the query
        const queries = await processQuery(originalQuery, queryConfig, llm);

        // SEARCH stage: search per query, fuse if multiple
        let scoredResults: ScoredChunk[];
        if (queries.length === 1) {
          scoredResults = await doSearch(queries[0], topK);
        } else {
          const perQueryResults = await Promise.all(
            queries.map((q) => doSearch(q, topK * 2)),
          );
          scoredResults = rrfFuseMultiple(perQueryResults);
        }

        // REFINEMENT stage: apply chain using original query
        if (refinementSteps.length > 0) {
          scoredResults = await applyRefinementChain(
            originalQuery, scoredResults, refinementSteps, topK, corpus, reranker,
          );
        }

        return scoredResults.slice(0, topK).map(({ chunk }) => chunk);
      },
      cleanupFn: async () => { bm25Cleanup?.(); },
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
