import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { internal } from "../convex/_generated/api";
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

async function seedGenerationJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  datasetId: Id<"datasets">,
  overrides: Partial<{
    status: string;
    phase: string;
    totalItems: number;
    processedItems: number;
    failedItems: number;
    skippedItems: number;
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("generationJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      datasetId,
      strategy: "simple",
      status: (overrides.status ?? "running") as any,
      phase: overrides.phase ?? "generating",
      totalItems: overrides.totalItems ?? 3,
      processedItems: overrides.processedItems ?? 0,
      failedItems: overrides.failedItems ?? 0,
      skippedItems: overrides.skippedItems ?? 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedQuestion(
  t: ReturnType<typeof convexTest>,
  datasetId: Id<"datasets">,
  index: number,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("questions", {
      datasetId,
      queryId: `q_${index}`,
      queryText: `What is question ${index}?`,
      sourceDocId: "doc_1",
      relevantSpans: [{ docId: "doc_1", start: 0, end: 10, text: "some text." }],
      metadata: {},
    });
  });
}

// ─── Tests ───

describe("generation: onQuestionGenerated", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("increments processedItems on success", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 3,
      processedItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_2" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.processedItems).toBe(2);
    expect(job!.failedItems).toBe(0);
    expect(job!.status).toBe("running");
  });

  it("increments failedItems and records details on failure", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 2,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "failed", error: "LLM timeout" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.failedItems).toBe(1);
    expect(job!.failedItemDetails).toEqual([
      { itemKey: "doc_1", error: "LLM timeout" },
    ]);
  });

  it("increments skippedItems on canceled result", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 2,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "canceled" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.skippedItems).toBe(1);
    expect(job!.failedItems).toBe(0);
  });

  it("transitions to ground-truth phase when Phase 1 completes with questions", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 1,
      processedItems: 0,
    });

    // Seed a question that would have been created by the generation action
    await seedQuestion(t, datasetId, 1);

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.phase).toBe("ground-truth");
    expect(job!.totalItems).toBe(1); // 1 question to process in Phase 2
    expect(job!.processedItems).toBe(0); // Reset for Phase 2
    expect(job!.phase1Stats).toEqual({
      processedItems: 1,
      failedItems: 0,
      skippedItems: 0,
    });
  });

  it("marks job as failed when all items fail and no questions exist", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "failed", error: "API error" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("failed");
    expect(job!.completedAt).toBeDefined();
  });

  it("marks job as canceled when canceling and all handled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      status: "canceling",
      totalItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "canceled" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("canceled");
    expect(job!.completedAt).toBeDefined();
  });

  it("ignores callback if job is already canceled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      status: "canceled",
      totalItems: 2,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    // Counters should not have changed
    expect(job!.processedItems).toBe(0);
  });

  it("ignores Phase 1 callback after Phase 2 has started (I9)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      phase: "ground-truth",
      totalItems: 2,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.processedItems).toBe(0);
  });
});

describe("generation: onGroundTruthAssigned", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("increments counters on success", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      phase: "ground-truth",
      totalItems: 3,
      processedItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onGroundTruthAssigned, {
      workId: "w_fake",
      context: { jobId, itemKey: "q_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.processedItems).toBe(2);
    expect(job!.status).toBe("running");
  });

  it("finalizes as completed when all Phase 2 items succeed", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    await seedQuestion(t, datasetId, 1);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      phase: "ground-truth",
      totalItems: 1,
      processedItems: 0,
    });

    await t.mutation(internal.generation.orchestration.onGroundTruthAssigned, {
      workId: "w_fake",
      context: { jobId, itemKey: "q_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed");
    expect(job!.completedAt).toBeDefined();

    // Dataset questionCount should be updated
    const dataset = await t.run(async (ctx) => ctx.db.get(datasetId));
    expect(dataset!.questionCount).toBe(1);
  });

  it("finalizes as completed_with_errors when Phase 1 had failures (I1)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    await seedQuestion(t, datasetId, 1);

    // Phase 2 job with phase1Stats showing 1 failure
    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("generationJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        strategy: "simple",
        status: "running" as any,
        phase: "ground-truth",
        totalItems: 1,
        processedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        phase1Stats: {
          processedItems: 2,
          failedItems: 1,
          skippedItems: 0,
        },
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    await t.mutation(internal.generation.orchestration.onGroundTruthAssigned, {
      workId: "w_fake",
      context: { jobId, itemKey: "q_1" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed_with_errors");
  });

  it("finalizes as canceled when job is canceling", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      status: "canceling",
      phase: "ground-truth",
      totalItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onGroundTruthAssigned, {
      workId: "w_fake",
      context: { jobId, itemKey: "q_1" },
      result: { kind: "canceled" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("canceled");
    expect(job!.completedAt).toBeDefined();
  });
});

describe("generation: getJob", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("returns job with computed pendingItems", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 10,
      processedItems: 3,
      failedItems: 2,
      skippedItems: 1,
    });

    const authedT = t.withIdentity(testIdentity);
    const job = await authedT.query(internal.generation.orchestration.getJob, { jobId });

    expect(job).not.toBeNull();
    expect(job!.pendingItems).toBe(4); // 10 - 3 - 2 - 1
  });

  it("returns null for wrong org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    // Create job with different org
    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("generationJobs", {
        orgId: "org_different",
        kbId,
        datasetId,
        strategy: "simple",
        status: "running" as any,
        phase: "generating",
        totalItems: 1,
        processedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const authedT = t.withIdentity(testIdentity);
    const job = await authedT.query(internal.generation.orchestration.getJob, { jobId });
    expect(job).toBeNull();
  });
});
