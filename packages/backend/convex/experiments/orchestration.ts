import {
  type RunResult,
  vOnCompleteArgs,
  type WorkId,
  Workpool
} from "@convex-dev/workpool"
import { v } from "convex/values"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalMutation } from "../_generated/server"
import { tenantMutation } from "../lib/auth/tenant"

// ─── Agent Experiment WorkPool ───

const agentPool = new Workpool(components.agentExperimentPool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2
  }
})

// ─── Start Agent Experiment ───

export const startAgentExperiment = tenantMutation({
  args: {
    datasetId: v.id("datasets"),
    agentId: v.id("agents"),
    name: v.string()
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = ctx

    const dataset = await ctx.db.get(args.datasetId)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }

    const agent = await ctx.db.get(args.agentId)
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found")
    }
    if (agent.status !== "ready") {
      throw new Error(
        `Agent is not ready (status: ${agent.status}). Configure and save the agent first.`
      )
    }

    // Verify at least one agent retriever is on the dataset's KB and ready
    let hasValidRetriever = false
    for (const retrieverId of agent.retrieverIds) {
      const retriever = await ctx.db.get(retrieverId)
      if (
        retriever &&
        retriever.kbId === dataset.kbId &&
        retriever.status === "ready"
      ) {
        hasValidRetriever = true
        break
      }
    }
    if (!hasValidRetriever) {
      throw new Error(
        "Agent has no ready retrievers on this dataset's knowledge base"
      )
    }

    const experimentId = await ctx.db.insert("experiments", {
      orgId,
      kbId: dataset.kbId,
      datasetId: args.datasetId,
      name: args.name,
      experimentType: "agent",
      agentId: args.agentId,
      metricNames: ["recall", "precision", "iou", "f1"],
      status: "pending",
      createdBy: userId,
      createdAt: Date.now()
    })

    // Schedule setup action (loads questions + enqueues per-question items)
    await ctx.scheduler.runAfter(
      0,
      internal.experiments.agentActions.runAgentExperimentSetup,
      {
        experimentId,
        datasetId: args.datasetId,
        kbId: dataset.kbId
      }
    )

    return { experimentId }
  }
})

// ─── Enqueue Agent Questions (called by setup action) ───

export const enqueueAgentQuestions = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    questionIds: v.array(v.id("questions")),
    agentId: v.id("agents"),
    kbId: v.id("knowledgeBases")
  },
  handler: async (ctx, args) => {
    const workIds: string[] = []

    for (const questionId of args.questionIds) {
      const wId = await agentPool.enqueueAction(
        ctx,
        internal.experiments.agentActions.evaluateAgentQuestion,
        {
          experimentId: args.experimentId,
          questionId,
          agentId: args.agentId,
          kbId: args.kbId
        },
        {
          context: {
            experimentId: args.experimentId,
            itemKey: questionId as string
          },
          onComplete: internal.experiments.orchestration.onAgentQuestionComplete
        }
      )
      workIds.push(wId as string)
    }

    await ctx.db.patch(args.experimentId, { workIds })
  }
})

// ─── onComplete: onAgentQuestionComplete ───

export const onAgentQuestionComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      experimentId: v.id("experiments"),
      itemKey: v.string()
    })
  ),
  handler: async (
    ctx,
    {
      context,
      result
    }: {
      workId: string
      context: { experimentId: Id<"experiments">; itemKey: string }
      result: RunResult
    }
  ) => {
    const experiment = await ctx.db.get(context.experimentId)
    if (!experiment) return
    if (experiment.status === "canceled") return

    // Increment counters
    const processed =
      (experiment.processedQuestions ?? 0) + (result.kind === "success" ? 1 : 0)
    const failed =
      (experiment.failedQuestions ?? 0) + (result.kind === "failed" ? 1 : 0)
    const skipped =
      (experiment.skippedQuestions ?? 0) + (result.kind === "canceled" ? 1 : 0)
    const totalHandled = processed + failed + skipped
    const isComplete = totalHandled >= (experiment.totalQuestions ?? 0)

    if (experiment.status === "canceling" && isComplete) {
      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped,
        status: "canceled",
        completedAt: Date.now()
      })
      return
    }

    if (isComplete) {
      // Aggregate scores from all completed results
      const results = await ctx.db
        .query("agentExperimentResults")
        .withIndex("by_experiment", (q) =>
          q.eq("experimentId", context.experimentId)
        )
        .collect()

      const metricNames = ["recall", "precision", "iou", "f1"]
      const avgScores: Record<string, number> = {}
      const completeResults = results.filter(
        (r) => r.status === "complete" && r.scores != null
      )
      for (const name of metricNames) {
        const values = completeResults
          .map((r) => (r.scores as Record<string, number>)[name])
          .filter((v): v is number => typeof v === "number")
        avgScores[name] =
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0
      }

      // Image metrics — averaged only over questions that have image ground
      // truth (relevantImageIds present on the question). Questions without it
      // are excluded so they don't dilute the image score. When no question in
      // the experiment has image ground truth, omit the image_* keys entirely
      // rather than writing 0s, which would read as evaluated scores.
      const imageMetricNames = ["image_recall", "image_precision", "image_f1"]
      const resultsWithImageScores = completeResults.filter((r) => {
        const s = r.scores as Record<string, number> | undefined
        return s != null && typeof s["image_f1"] === "number"
      })
      if (resultsWithImageScores.length > 0) {
        for (const name of imageMetricNames) {
          const values = resultsWithImageScores
            .map((r) => (r.scores as Record<string, number>)[name])
            .filter((v): v is number => typeof v === "number")
          avgScores[name] =
            values.length > 0
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0
        }
        // image_coverage = fraction of questions that contributed to image metrics
        const totalQuestions = experiment.totalQuestions ?? results.length
        avgScores["image_coverage"] =
          totalQuestions > 0
            ? resultsWithImageScores.length / totalQuestions
            : 0
      }

      const status =
        failed > 0 && processed === 0
          ? ("failed" as const)
          : failed > 0
            ? ("completed_with_errors" as const)
            : ("completed" as const)

      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped,
        status,
        scores: avgScores,
        phase: "done",
        completedAt: Date.now()
      })
    } else {
      // Progress update
      await ctx.db.patch(context.experimentId, {
        processedQuestions: processed,
        failedQuestions: failed,
        skippedQuestions: skipped
      })
    }
  }
})

// ─── Cancel Agent Experiment ───

export const cancelAgentExperiment = tenantMutation({
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
      await agentPool.cancel(ctx, wId as WorkId)
    }
  }
})
