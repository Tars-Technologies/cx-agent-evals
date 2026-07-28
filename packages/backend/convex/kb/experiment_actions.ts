"use node"

/**
 * Single-action experiment runner via eval-lib's native retriever evaluation.
 *
 * Actions live here ("use node") because they import eval-lib, which
 * depends on Node.js built-ins unavailable in the Convex edge runtime.
 */
import {
  CallbackRetriever,
  computeIndexConfigHash,
  createCorpusFromDocuments,
  createDocument,
  DocumentId,
  runRetrieverEvaluation
} from "@tars-inc/eval-lib"
import type { ExperimentResult } from "@tars-inc/eval-lib/shared"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalAction } from "../_generated/server"
import { env } from "../env"
import { resolveMaxConcurrency } from "../lib/experimentConcurrency"
import { buildStatelessRetriever } from "./retrieval_runtime"

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
    kbId: v.id("knowledgeBases")
  },
  handler: async (ctx, args) => {
    try {
      // ── Step 0: Initialize ──
      // The starter is scheduled before any workIds exist, so a cancel that
      // lands while the experiment is still pending can't be caught by the
      // WorkPool. Re-check status here and bail before doing any work.
      const experiment = await ctx.runQuery(
        internal.kb.experiments.getInternal,
        {
          id: args.experimentId
        }
      )
      if (
        experiment.status === "canceling" ||
        experiment.status === "canceled"
      ) {
        await ctx.runMutation(internal.kb.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "canceled"
        })
        return
      }

      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "initializing"
      })

      let indexConfigHash: string
      let embeddingModel: string
      let experimentK: number

      if (experiment.retrieverId) {
        // ── Retriever path: load config, skip indexing ──
        const retriever = await ctx.runQuery(
          internal.kb.retrievers.getInternal,
          {
            id: experiment.retrieverId
          }
        )
        if (retriever.status !== "ready") {
          throw new Error(
            `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
          )
        }

        indexConfigHash = retriever.indexConfigHash
        experimentK = retriever.defaultK

        const retConfig = retriever.retrieverConfig as Record<string, any>
        const idxSettings = (retConfig.index ?? {}) as Record<string, any>
        embeddingModel =
          (idxSettings.embeddingModel as string) ?? "text-embedding-3-small"
      } else {
        // ── Legacy path: compute hash, trigger indexing ──
        const retrieverConfig = experiment.retrieverConfig as Record<
          string,
          any
        >
        const indexSettings = (retrieverConfig.index ?? {}) as Record<
          string,
          any
        >
        embeddingModel =
          (indexSettings.embeddingModel as string) ?? "text-embedding-3-small"
        experimentK = (experiment.k as number) ?? 5

        const indexConfig = {
          strategy: "plain" as const,
          chunkSize: (indexSettings.chunkSize as number) ?? 1000,
          chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
          separators: indexSettings.separators as string[] | undefined,
          embeddingModel,
          vectorBackend: indexSettings.vectorBackend as
            | "native"
            | "qdrant"
            | undefined,
          embeddingProvider: indexSettings.embeddingProvider as
            | "openai"
            | "openrouter"
            | "cohere"
            | undefined
        }
        indexConfigHash = computeIndexConfigHash({
          name: retrieverConfig.name ?? "experiment",
          index: indexConfig
        })

        const indexResult = await ctx.runMutation(
          internal.kb.indexing.startIndexing,
          {
            orgId: experiment.orgId,
            kbId: args.kbId,
            indexConfigHash,
            indexConfig,
            createdBy: experiment.createdBy
          }
        )

        if (!indexResult.alreadyCompleted) {
          await ctx.runMutation(internal.kb.experiments.updateStatus, {
            experimentId: args.experimentId,
            status: "running",
            phase: "indexing"
          })

          let indexingDone = false
          while (!indexingDone) {
            await new Promise((resolve) => setTimeout(resolve, 2000))
            const indexJob = await ctx.runQuery(
              internal.kb.indexing.getJobInternal,
              { jobId: indexResult.jobId }
            )
            if (!indexJob) throw new Error("Indexing job disappeared")

            if (
              indexJob.status === "completed" ||
              indexJob.status === "completed_with_errors"
            ) {
              indexingDone = true
            } else if (indexJob.status === "failed") {
              throw new Error(
                "Indexing failed: " + (indexJob.error ?? "unknown")
              )
            } else if (indexJob.status === "canceled") {
              throw new Error("Indexing was canceled")
            }
          }
        }
      }

      // ── Step 2: Load questions (needed for staleness check + guard) ──
      const allQuestions = await ctx.runQuery(
        internal.kb.questions.byDatasetInternal,
        { datasetId: args.datasetId }
      )
      // Skip questions with no ground truth spans — they inflate recall
      // and drag down precision, making retriever metrics meaningless.
      const questions = allQuestions.filter(
        (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0
      )

      if (questions.length === 0) {
        await ctx.runMutation(internal.kb.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "completed",
          phase: "done",
          totalQuestions: 0
        })
        return
      }

      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length
      })

      // ── Step 4: Enqueue single evaluation WorkPool item ──
      await ctx.runMutation(internal.kb.experiments.enqueueExperiment, {
        experimentId: args.experimentId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        indexConfigHash,
        embeddingModel,
        k: experimentK
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "failed",
        error: message
      })
    }
  }
})

// ─── Single Evaluation Action ───

/**
 * Run the full evaluation via eval-lib's runRetrieverEvaluation().
 * This is enqueued as a single WorkPool item (no retry).
 */
export const runEvaluation = internalAction({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number()
  },
  handler: async (ctx, args) => {
    const experiment = await ctx.runQuery(internal.kb.experiments.getInternal, {
      id: args.experimentId
    })

    // Load all documents to build corpus
    const docs = await ctx.runQuery(internal.kb.documents.listByKbInternal, {
      kbId: args.kbId
    })
    const corpus = createCorpusFromDocuments(
      docs.map((d: any) => createDocument({ id: d.docId, content: d.content }))
    )

    // Only include questions with ground truth spans so retriever metrics are
    // not distorted by unanswerable questions. Each dataset entry carries its
    // stable Convex ID so duplicate query text cannot misfile results.
    const allQuestions = await ctx.runQuery(
      internal.kb.questions.byDatasetInternal,
      { datasetId: args.datasetId }
    )
    const questions = allQuestions.filter(
      (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0
    )
    // Resolve retriever/experiment config for the unified retriever.
    // The legacy path (no retriever record) carries no stored collection
    // name; buildStatelessRetriever falls back to the computed one.
    let retrieverConfigObj: Record<string, any> = {}
    let qdrantCollection: string | undefined
    if (experiment.retrieverId) {
      const ret = await ctx.runQuery(internal.kb.retrievers.getInternal, {
        id: experiment.retrieverId
      })
      retrieverConfigObj = (ret.retrieverConfig ?? {}) as Record<string, any>
      qdrantCollection = ret.qdrantCollection
    } else {
      retrieverConfigObj = (experiment.retrieverConfig ?? {}) as Record<
        string,
        any
      >
    }

    const searchStrategy =
      ((retrieverConfigObj.search as Record<string, unknown>)
        ?.strategy as string) ?? "dense"

    const unified = await buildStatelessRetriever(ctx, {
      kbId: args.kbId,
      indexConfigHash: args.indexConfigHash,
      retrieverConfig: retrieverConfigObj,
      preloadedCorpus: corpus,
      qdrantCollection
    })

    const retriever = new CallbackRetriever({
      name: `convex-${searchStrategy}-search`,
      retrieveFn: (q: string, topK: number) => unified.retrieve(q, topK),
      cleanupFn: async () => unified.cleanup()
    })

    // Run evaluation via eval-lib's native retriever evaluation
    const total = questions.length
    const maxConcurrency = resolveMaxConcurrency(env.EXPERIMENT_MAX_CONCURRENCY)
    // Coalesce progress writes so concurrent onResult callbacks don't contend
    // on the experiment row: ~100 updates max, plus the final one.
    const progressStep = Math.max(1, Math.ceil(total / 100))
    let resultsCount = 0
    const evalStartedAt = Date.now()

    const dataset = questions.map((q: any) => ({
      exampleId: String(q._id),
      query: q.queryText,
      groundTruth: (q.relevantSpans as Array<{
        docId: string
        start: number
        end: number
        text: string
      }>).map((s) => ({
        docId: DocumentId(s.docId),
        start: s.start,
        end: s.end,
        text: s.text
      }))
    }))

    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: args.k,
      dataset,
      maxConcurrency,
      onResult: async (result: ExperimentResult) => {
        if (!result.exampleId) {
          throw new Error("Evaluation result is missing its stable example ID")
        }
        await ctx.runMutation(internal.kb.results.insert, {
          experimentId: args.experimentId,
          questionId: result.exampleId as Id<"questions">,
          retrievedSpans: result.retrievedSpans,
          scores: result.scores,
          metadata: {}
        })
        const n = ++resultsCount
        if (n % progressStep === 0 || n === total) {
          await ctx.runMutation(internal.kb.experiments.updateStatus, {
            experimentId: args.experimentId,
            status: "running",
            phase: "evaluating",
            processedQuestions: n
          })
        }
      }
    })

    const elapsedMs = Date.now() - evalStartedAt
    const perQ = elapsedMs / Math.max(1, resultsCount)
    console.info(
      `[Experiment ${args.experimentId}] evaluated ${resultsCount}/${total} questions in ${(elapsedMs / 1000).toFixed(1)}s (${perQ.toFixed(0)}ms/q, maxConcurrency=${maxConcurrency})`
    )

    // Aggregate scores after the evaluation completes
    const results = await ctx.runQuery(
      internal.kb.results.byExperimentInternal,
      { experimentId: args.experimentId }
    )

    const metricNames = experiment.metricNames
    const avgScores: Record<string, number> = {}

    for (const name of metricNames) {
      const values = results
        .map((r: any) => (r.scores as Record<string, number>)[name])
        .filter((v: unknown): v is number => typeof v === "number")

      avgScores[name] =
        values.length > 0
          ? values.reduce((a: number, b: number) => a + b, 0) / values.length
          : 0
    }

    // Mark experiment complete with aggregated scores. Stamp the final
    // processedQuestions so the counter is exact even if a coalesced in-loop
    // write was skipped or the evaluated count drifted from `total`.
    await ctx.runMutation(internal.kb.experiments.updateStatus, {
      experimentId: args.experimentId,
      status: "completed",
      scores: avgScores,
      phase: "done",
      processedQuestions: resultsCount
    })
  }
})
