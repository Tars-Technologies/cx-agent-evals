/**
 * KB experiment queries + mutations: start, status/list, cancel.
 *
 * Owns the KB experiment WorkPool and its onComplete callback; actual
 * LangSmith evaluate() execution is delegated to experiment_actions.ts.
 */
import {
  type RunResult,
  vOnCompleteArgs,
  type WorkId,
  Workpool
} from "@convex-dev/workpool"
import { v } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"

// ─── WorkPool Instance ───

const pool = new Workpool(components.experimentPool, {
  maxParallelism: 1,
  // Retry is disabled: evaluate() processes the full dataset sequentially.
  // If it times out, retrying from scratch won't help.
  retryActionsByDefault: false
})

/** Statuses an experiment can no longer transition out of. */
const TERMINAL_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "canceled"
])

// ─── Start Experiment ───

export const start = tenantMutation({
  args: {
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverId: v.optional(v.id("retrievers")),
    retrieverConfig: v.optional(v.any()),
    k: v.optional(v.number()),
    metricNames: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = ctx

    const dataset = await ctx.db.get(args.datasetId)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }

    // Validate: must provide exactly one of retrieverId or retrieverConfig
    if (!args.retrieverId && !args.retrieverConfig) {
      throw new Error("Must provide either retrieverId or retrieverConfig")
    }
    if (args.retrieverId && args.retrieverConfig) {
      throw new Error("Provide either retrieverId or retrieverConfig, not both")
    }

    // If using retrieverId, verify the retriever is ready and KB matches
    if (args.retrieverId) {
      const retriever = await ctx.db.get(args.retrieverId)
      if (!retriever || retriever.orgId !== orgId) {
        throw new Error("Retriever not found")
      }
      if (retriever.status !== "ready") {
        throw new Error(
          `Retriever is not ready (status: ${retriever.status}). Index the KB first.`
        )
      }
      if (retriever.kbId !== dataset.kbId) {
        throw new Error(
          "Retriever and dataset must belong to the same knowledge base"
        )
      }
    }

    const experimentId = await ctx.db.insert("experiments", {
      orgId,
      kbId: dataset.kbId,
      datasetId: args.datasetId,
      name: args.name,
      retrieverId: args.retrieverId,
      retrieverConfig: args.retrieverConfig,
      k: args.k,
      metricNames: args.metricNames,
      status: "pending",
      createdBy: userId,
      createdAt: Date.now()
    })

    // Schedule the orchestrator action
    await ctx.scheduler.runAfter(
      0,
      internal.kb.experiment_actions.runExperiment,
      {
        experimentId,
        datasetId: args.datasetId,
        kbId: dataset.kbId
      }
    )

    return { experimentId }
  }
})

// ─── onComplete: onExperimentComplete ───

/**
 * Handles completion of the single evaluate() WorkPool item.
 * On success: experiment should already be marked complete by the action.
 * On failure: mark experiment as failed.
 * On cancel: mark experiment as canceled.
 */
export const onExperimentComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      experimentId: v.id("experiments")
    })
  ),
  handler: async (
    ctx,
    {
      context,
      result
    }: {
      workId: string
      context: { experimentId: Id<"experiments"> }
      result: RunResult
    }
  ) => {
    const experiment = await ctx.db.get(context.experimentId)
    if (!experiment) return

    if (result.kind === "success") {
      // The action itself marks the experiment as completed with scores.
      // If part of a run, notify the parent.
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(
          0,
          internal.kb.experimentRuns.onChildComplete,
          {
            experimentRunId: experiment.experimentRunId,
            experimentId: context.experimentId,
            success: true
          }
        )
      }
      return
    }

    if (result.kind === "canceled") {
      await ctx.db.patch(context.experimentId, {
        status: "canceled",
        completedAt: Date.now()
      })
      // Notify parent run (count as failed)
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(
          0,
          internal.kb.experimentRuns.onChildComplete,
          {
            experimentRunId: experiment.experimentRunId,
            experimentId: context.experimentId,
            success: false
          }
        )
      }
      return
    }

    // A late WorkPool failure can arrive after the action already persisted a
    // terminal status; preserve that source of truth.
    const alreadySucceeded =
      experiment.status === "completed" ||
      experiment.status === "completed_with_errors"
    const alreadyTerminal = TERMINAL_STATUSES.has(experiment.status)

    if (!alreadyTerminal) {
      await ctx.db.patch(context.experimentId, {
        status: "failed",
        error: result.error ?? "Evaluation action failed",
        completedAt: Date.now()
      })
    }
    if (experiment.experimentRunId) {
      await ctx.runMutation(internal.kb.experimentRuns.onChildComplete, {
        experimentRunId: experiment.experimentRunId,
        experimentId: context.experimentId,
        success: alreadySucceeded
      })
    }
  }
})

// ─── Cancel Experiment ───

export const cancelExperiment = tenantMutation({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const experiment = await ctx.db.get(args.experimentId)
    if (!experiment || experiment.orgId !== orgId) {
      throw new Error("Experiment not found")
    }
    if (experiment.status !== "running" && experiment.status !== "pending") {
      throw new Error(
        `Cannot cancel experiment in status: ${experiment.status}`
      )
    }

    await ctx.db.patch(args.experimentId, { status: "canceling" })

    const workIds = experiment.workIds ?? []
    for (const wId of workIds) {
      await pool.cancel(ctx, wId as WorkId)
    }
  }
})

// ─── Enqueue Experiment (single WorkPool item) ───

export const enqueueExperiment = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    embeddingModel: v.string(),
    k: v.number(),
    datasetName: v.string()
  },
  handler: async (ctx, args) => {
    const wId = await pool.enqueueAction(
      ctx,
      internal.kb.experiment_actions.runEvaluation,
      {
        experimentId: args.experimentId,
        datasetId: args.datasetId,
        kbId: args.kbId,
        indexConfigHash: args.indexConfigHash,
        embeddingModel: args.embeddingModel,
        k: args.k,
        datasetName: args.datasetName
      },
      {
        context: {
          experimentId: args.experimentId
        },
        onComplete: internal.kb.experiments.onExperimentComplete
      }
    )

    await ctx.db.patch(args.experimentId, { workIds: [wId as string] })
  }
})

// ─── Internal Queries/Mutations ───

export const getInternal = internalQuery({
  args: { id: v.id("experiments") },
  handler: async (ctx, args) => {
    const exp = await ctx.db.get(args.id)
    if (!exp) throw new Error("Experiment not found")
    return exp
  }
})

export const updateStatus = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled")
    ),
    scores: v.optional(v.record(v.string(), v.number())),
    error: v.optional(v.string()),
    phase: v.optional(
      v.union(
        v.literal("initializing"),
        v.literal("indexing"),
        v.literal("syncing"),
        v.literal("evaluating"),
        v.literal("done")
      )
    ),
    totalQuestions: v.optional(v.number()),
    processedQuestions: v.optional(v.number()),
    langsmithExperimentId: v.optional(v.string()),
    langsmithUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status }
    // Stamp completedAt only on the first transition into a terminal state,
    // so a later terminal write can't overwrite the true finish time.
    if (TERMINAL_STATUSES.has(args.status)) {
      const current = await ctx.db.get(args.experimentId)
      if (current && current.completedAt === undefined) {
        patch.completedAt = Date.now()
      }
    }
    if (args.scores !== undefined) patch.scores = args.scores
    if (args.error !== undefined) patch.error = args.error
    if (args.phase !== undefined) patch.phase = args.phase
    if (args.totalQuestions !== undefined)
      patch.totalQuestions = args.totalQuestions
    if (args.processedQuestions !== undefined)
      patch.processedQuestions = args.processedQuestions
    if (args.langsmithExperimentId !== undefined)
      patch.langsmithExperimentId = args.langsmithExperimentId
    if (args.langsmithUrl !== undefined) patch.langsmithUrl = args.langsmithUrl
    await ctx.db.patch(args.experimentId, patch)
  }
})

// ─── Public Queries ───

export const byDataset = tenantQuery({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const dataset = await ctx.db.get(args.datasetId)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }

    return await ctx.db
      .query("experiments")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .order("desc")
      .collect()
  }
})

export const byOrg = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const { orgId } = ctx
    return await ctx.db
      .query("experiments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect()
  }
})

export const byKb = tenantQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }

    return await ctx.db
      .query("experiments")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect()
  }
})

export const get = tenantQuery({
  args: { id: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const exp = await ctx.db.get(args.id)
    // Return null instead of throwing — query is used by useQuery which
    // may call with a stale/deleted experiment ID
    if (!exp || exp.orgId !== orgId) return null
    return exp
  }
})
