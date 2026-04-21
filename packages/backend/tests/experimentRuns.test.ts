import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  TEST_ORG_ID,
  testIdentity,
  setupTest,
  seedUser,
  seedKB,
  seedDataset,
} from "./helpers";

// ─── Domain-Specific Seeders ───

async function seedRetriever(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  overrides: Partial<{
    status: "configuring" | "indexing" | "ready" | "error";
    name: string;
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("retrievers", {
      orgId: TEST_ORG_ID,
      kbId,
      name: overrides.name ?? "Test Retriever",
      retrieverConfig: {},
      indexConfigHash: "hash-index-123",
      retrieverConfigHash: "hash-retriever-123",
      defaultK: 5,
      status: overrides.status ?? "ready",
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

// ─── Tests ───

describe("experimentRuns", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  // ─── Test 1: create inserts parent run and child experiments ───

  it("create inserts parent run and child experiments", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const retriever1Id = await seedRetriever(t, userId, kbId, {
      name: "Retriever A",
      status: "ready",
    });
    const retriever2Id = await seedRetriever(t, userId, kbId, {
      name: "Retriever B",
      status: "ready",
    });

    const authedT = t.withIdentity(testIdentity);
    const result = await authedT.mutation(
      api.experimentRuns.orchestration.create,
      {
        name: "My Experiment Run",
        kbId,
        datasetId,
        retrieverIds: [retriever1Id, retriever2Id],
        metricNames: ["recall", "precision"],
        scoringWeights: { recall: 0.5, precision: 0.5 },
      },
    );

    expect(result).toHaveProperty("runId");
    const { runId } = result;

    // Verify run record
    const run = await t.run(async (ctx) => ctx.db.get(runId));
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.totalRetrievers).toBe(2);
    expect(run!.completedRetrievers).toBe(0);
    expect(run!.failedRetrievers).toBe(0);

    // Verify 2 child experiments created
    const children = await t.run(async (ctx) =>
      ctx.db
        .query("experiments")
        .withIndex("by_run", (q) => q.eq("experimentRunId", runId))
        .collect(),
    );
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.experimentRunId).toBe(runId);
    }
  });

  // ─── Test 2: rejects if weights don't sum to 1.0 ───

  it("rejects if weights don't sum to 1.0", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const retrieverId = await seedRetriever(t, userId, kbId, { status: "ready" });

    const authedT = t.withIdentity(testIdentity);
    await expect(
      authedT.mutation(
        api.experimentRuns.orchestration.create,
        {
          name: "Bad Weights Run",
          kbId,
          datasetId,
          retrieverIds: [retrieverId],
          metricNames: ["recall", "precision"],
          scoringWeights: { recall: 0.5, precision: 0.3 },
        },
      ),
    ).rejects.toThrow("Scoring weights must sum to 1.0");
  });

  // ─── Test 3: rejects if retriever not ready ───

  it("rejects if retriever not ready", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "configuring",
      name: "Not Ready Retriever",
    });

    const authedT = t.withIdentity(testIdentity);
    await expect(
      authedT.mutation(
        api.experimentRuns.orchestration.create,
        {
          name: "Not Ready Run",
          kbId,
          datasetId,
          retrieverIds: [retrieverId],
          metricNames: ["recall"],
          scoringWeights: { recall: 1.0, precision: 0.0 },
        },
      ),
    ).rejects.toThrow("not ready");
  });

  // ─── Test 4: onChildComplete transitions run to completed when all children done ───

  it("onChildComplete transitions run to completed when all children done", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const retriever1Id = await seedRetriever(t, userId, kbId, { name: "R1", status: "ready" });
    const retriever2Id = await seedRetriever(t, userId, kbId, { name: "R2", status: "ready" });

    // Insert parent run directly
    const experimentRunId = await t.run(async (ctx) =>
      ctx.db.insert("experimentRuns", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Test Run",
        retrieverIds: [retriever1Id, retriever2Id],
        metricNames: ["recall", "precision"],
        scoringWeights: { recall: 0.6, precision: 0.4 },
        status: "running",
        totalRetrievers: 2,
        completedRetrievers: 0,
        failedRetrievers: 0,
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    // Insert 2 child experiments with scores
    const child1Id = await t.run(async (ctx) =>
      ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Child Exp 1",
        experimentRunId,
        retrieverId: retriever1Id,
        metricNames: ["recall", "precision"],
        status: "completed",
        scores: { recall: 0.9, precision: 0.8 },
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    const child2Id = await t.run(async (ctx) =>
      ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Child Exp 2",
        experimentRunId,
        retrieverId: retriever2Id,
        metricNames: ["recall", "precision"],
        status: "completed",
        scores: { recall: 0.7, precision: 0.6 },
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    // Fire onChildComplete for first child — run should still be "running"
    await t.mutation(internal.experimentRuns.orchestration.onChildComplete, {
      experimentRunId,
      experimentId: child1Id,
      success: true,
    });

    const runAfterFirst = await t.run(async (ctx) => ctx.db.get(experimentRunId));
    expect(runAfterFirst!.status).toBe("running");
    expect(runAfterFirst!.completedRetrievers).toBe(1);

    // Fire onChildComplete for second child — run should now be "completed"
    await t.mutation(internal.experimentRuns.orchestration.onChildComplete, {
      experimentRunId,
      experimentId: child2Id,
      success: true,
    });

    const runAfterSecond = await t.run(async (ctx) => ctx.db.get(experimentRunId));
    expect(runAfterSecond!.status).toBe("completed");
    expect(runAfterSecond!.completedRetrievers).toBe(2);
    expect(runAfterSecond!.winnerId).toBeDefined();
    expect(runAfterSecond!.winnerName).toBeDefined();
    expect(runAfterSecond!.winnerScore).toBeDefined();
    // Retriever 1 should win: 0.6*0.9 + 0.4*0.8 = 0.54 + 0.32 = 0.86 vs 0.6*0.7 + 0.4*0.6 = 0.42 + 0.24 = 0.66
    expect(runAfterSecond!.winnerId).toBe(retriever1Id);
  });

  // ─── Test 5: onChildComplete marks run as completed_with_errors when some fail ───

  it("onChildComplete marks run as completed_with_errors when some fail", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const retriever1Id = await seedRetriever(t, userId, kbId, { name: "R1", status: "ready" });
    const retriever2Id = await seedRetriever(t, userId, kbId, { name: "R2", status: "ready" });

    // Insert parent run directly
    const experimentRunId = await t.run(async (ctx) =>
      ctx.db.insert("experimentRuns", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Test Run With Errors",
        retrieverIds: [retriever1Id, retriever2Id],
        metricNames: ["recall", "precision"],
        scoringWeights: { recall: 0.5, precision: 0.5 },
        status: "running",
        totalRetrievers: 2,
        completedRetrievers: 0,
        failedRetrievers: 0,
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    // Insert 2 child experiments
    const child1Id = await t.run(async (ctx) =>
      ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Child Exp 1",
        experimentRunId,
        retrieverId: retriever1Id,
        metricNames: ["recall", "precision"],
        status: "completed",
        scores: { recall: 0.8, precision: 0.7 },
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    const child2Id = await t.run(async (ctx) =>
      ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        name: "Child Exp 2",
        experimentRunId,
        retrieverId: retriever2Id,
        metricNames: ["recall", "precision"],
        status: "failed",
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    // First child succeeds
    await t.mutation(internal.experimentRuns.orchestration.onChildComplete, {
      experimentRunId,
      experimentId: child1Id,
      success: true,
    });

    // Second child fails
    await t.mutation(internal.experimentRuns.orchestration.onChildComplete, {
      experimentRunId,
      experimentId: child2Id,
      success: false,
    });

    const run = await t.run(async (ctx) => ctx.db.get(experimentRunId));
    expect(run!.status).toBe("completed_with_errors");
    expect(run!.completedRetrievers).toBe(1);
    expect(run!.failedRetrievers).toBe(1);
    // Winner should still be set from the one that succeeded
    expect(run!.winnerId).toBe(retriever1Id);
  });
});
