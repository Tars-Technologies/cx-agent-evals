import type { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import {
  seedDataset,
  seedKB,
  seedUser,
  setupTest,
  TEST_ORG_ID,
  testIdentity
} from "./helpers"

// ─── Domain-Specific Seeders ───

type ExperimentStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceling"
  | "canceled"

type ExperimentPhase =
  | "initializing"
  | "indexing"
  | "syncing"
  | "evaluating"
  | "done"

async function seedExperiment(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  datasetId: Id<"datasets">,
  overrides: Partial<{
    status: ExperimentStatus
    phase: ExperimentPhase
    totalQuestions: number
    processedQuestions: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("experiments", {
      orgId: TEST_ORG_ID,
      datasetId,
      name: "Test Experiment",
      metricNames: ["recall", "precision", "iou", "f1"],
      status: overrides.status ?? "running",
      phase: overrides.phase ?? "evaluating",
      totalQuestions: overrides.totalQuestions ?? 3,
      processedQuestions: overrides.processedQuestions ?? 0,
      createdBy: userId,
      createdAt: Date.now()
    })
  })
}

// ─── Tests ───

describe("experiments: onExperimentComplete", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("does nothing on success (action marks experiment complete)", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "completed",
      phase: "done"
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "success", returnValue: {} }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    // Status should remain "completed" — action already handled it
    expect(exp!.status).toBe("completed")
  })

  it("marks experiment as failed when action fails", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "running"
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Action timed out" }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("failed")
    expect(exp!.error).toBe("Action timed out")
    expect(exp!.completedAt).toBeDefined()
  })

  it("marks experiment as canceled when WorkPool item is canceled", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "canceling"
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "canceled" }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("canceled")
    expect(exp!.completedAt).toBeDefined()
  })

  it("does not overwrite if experiment already marked failed by action", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "failed"
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Duplicate failure" }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    // Should not overwrite — status was already "failed"
    expect(exp!.status).toBe("failed")
    expect(exp!.error).toBeUndefined() // Original had no error set
  })

  it("does not clobber a completed experiment when the wrapper times out", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "completed",
      phase: "done"
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(experimentId, {
        scores: { recall: 0.8, precision: 0.6 },
        completedAt: 1_000
      })
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Function execution timed out" }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("completed")
    expect(exp!.scores).toEqual({ recall: 0.8, precision: 0.6 })
    expect(exp!.error).toBeUndefined()
    expect(exp!.completedAt).toBe(1_000)
  })

  it("reports success to the parent run when a completed child times out", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)

    const { runId, experimentId } = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("experimentRuns", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Run",
        retrieverIds: [],
        metricNames: ["recall", "precision"],
        scoringWeights: { recall: 0.7, precision: 0.3 },
        status: "running",
        totalRetrievers: 1,
        completedRetrievers: 0,
        failedRetrievers: 0,
        createdBy: userId,
        createdAt: Date.now()
      })
      const experimentId = await ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Run — child",
        experimentRunId: runId,
        metricNames: ["recall", "precision"],
        status: "completed",
        phase: "done",
        scores: { recall: 0.8, precision: 0.6 },
        createdBy: userId,
        createdAt: Date.now()
      })
      return { runId, experimentId }
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Function execution timed out" }
    })

    const run = await t.run(async (ctx) => ctx.db.get(runId))
    expect(run!.completedRetrievers).toBe(1)
    expect(run!.failedRetrievers).toBe(0)
    expect(run!.status).toBe("completed")
  })

  it("does not clobber a canceled experiment when a late failed result arrives", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "canceled"
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(experimentId, {
        completedAt: 1_000
      })
    })

    await t.mutation(internal.kb.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Function execution timed out" }
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("canceled")
    expect(exp!.error).toBeUndefined()
    expect(exp!.completedAt).toBe(1_000)
  })
})

describe("experiments: updateStatus completedAt", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("stamps completedAt when transitioning to a terminal status", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "running"
    })

    await t.mutation(internal.kb.experiments.updateStatus, {
      experimentId,
      status: "completed",
      scores: { recall: 0.9 },
      phase: "done"
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("completed")
    expect(exp!.completedAt).toBeDefined()
  })

  it("does not set completedAt for a non-terminal status", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "pending"
    })

    await t.mutation(internal.kb.experiments.updateStatus, {
      experimentId,
      status: "running",
      phase: "evaluating"
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("running")
    expect(exp!.completedAt).toBeUndefined()
  })

  it("preserves the original completedAt on a later terminal write", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "running"
    })

    await t.mutation(internal.kb.experiments.updateStatus, {
      experimentId,
      status: "completed",
      phase: "done"
    })
    const first = await t.run(async (ctx) => ctx.db.get(experimentId))
    const firstCompletedAt = first!.completedAt
    expect(firstCompletedAt).toBeDefined()

    await t.mutation(internal.kb.experiments.updateStatus, {
      experimentId,
      status: "failed",
      error: "late failure"
    })

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId))
    expect(exp!.status).toBe("failed")
    expect(exp!.completedAt).toBe(firstCompletedAt)
  })
})

describe("experiments: get query", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("returns null for wrong org (C3)", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)

    const experimentId = await t.run(async (ctx) => {
      return await ctx.db.insert("experiments", {
        orgId: "org_different",
        datasetId,
        name: "Other Org Experiment",
        metricNames: ["recall"],
        status: "completed",
        createdBy: userId,
        createdAt: Date.now()
      })
    })

    const authedT = t.withIdentity(testIdentity)
    const exp = await authedT.query(internal.kb.experiments.get, {
      id: experimentId
    })
    expect(exp).toBeNull()
  })

  it("returns experiment for correct org", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    const experimentId = await seedExperiment(t, userId, datasetId)

    const authedT = t.withIdentity(testIdentity)
    const exp = await authedT.query(internal.kb.experiments.get, {
      id: experimentId
    })
    expect(exp).not.toBeNull()
    expect(exp!.name).toBe("Test Experiment")
  })
})
