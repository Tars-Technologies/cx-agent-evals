import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import workpoolTest from "@convex-dev/workpool/test";

// Module maps for convex-test
const modules = import.meta.glob("../convex/**/*.ts");

// ─── Test Helpers ───

const TEST_ORG_ID = "org_test123";
const TEST_CLERK_ID = "user_test456";

const testIdentity = {
  subject: TEST_CLERK_ID,
  issuer: "https://test.clerk.com",
  org_id: TEST_ORG_ID,
  org_role: "org:admin",
};

function setupTest() {
  const t = convexTest(schema, modules);
  workpoolTest.register(t, "indexingPool");
  workpoolTest.register(t, "generationPool");
  workpoolTest.register(t, "experimentPool");
  return t;
}

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      clerkId: TEST_CLERK_ID,
      email: "test@test.com",
      name: "Test User",
      createdAt: Date.now(),
    });
  });
}

async function seedKB(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("knowledgeBases", {
      orgId: TEST_ORG_ID,
      name: "Test KB",
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedDataset(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Dataset",
      strategy: "simple",
      strategyConfig: {},
      questionCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedExperiment(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  datasetId: Id<"datasets">,
  overrides: Partial<{
    status: string;
    phase: string;
    totalQuestions: number;
    processedQuestions: number;
    failedQuestions: number;
    skippedQuestions: number;
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("experiments", {
      orgId: TEST_ORG_ID,
      datasetId,
      name: "Test Experiment",
      metricNames: ["recall", "precision", "iou", "f1"],
      status: (overrides.status ?? "running") as any,
      phase: overrides.phase ?? "evaluating",
      totalQuestions: overrides.totalQuestions ?? 3,
      processedQuestions: overrides.processedQuestions ?? 0,
      failedQuestions: overrides.failedQuestions ?? 0,
      skippedQuestions: overrides.skippedQuestions ?? 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedExperimentResult(
  t: ReturnType<typeof convexTest>,
  experimentId: Id<"experiments">,
  questionId: Id<"questions">,
  scores: Record<string, number>,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("experimentResults", {
      experimentId,
      questionId,
      retrievedSpans: [{ docId: "doc_1", start: 0, end: 10, text: "some text." }],
      scores,
      metadata: {},
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

describe("experiments: onQuestionEvaluated", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("increments processedQuestions on success", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 3,
      processedQuestions: 1,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.processedQuestions).toBe(2);
    expect(exp!.failedQuestions).toBe(0);
    expect(exp!.status).toBe("running");
  });

  it("increments failedQuestions on failure", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 2,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "failed", error: "Embedding error" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.failedQuestions).toBe(1);
    expect(exp!.processedQuestions).toBe(0);
  });

  it("increments skippedQuestions on canceled (I2)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 2,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "canceled" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.skippedQuestions).toBe(1);
    expect(exp!.failedQuestions).toBe(0);
  });

  it("aggregates scores and completes when all questions processed", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const q1 = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 1,
      processedQuestions: 0,
    });

    // Seed an experiment result that the aggregation will find
    await seedExperimentResult(t, experimentId, q1, {
      recall: 0.8,
      precision: 0.9,
      iou: 0.7,
      f1: 0.85,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId: q1 },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.status).toBe("completed");
    expect(exp!.phase).toBe("done");
    expect(exp!.completedAt).toBeDefined();

    const scores = exp!.scores as Record<string, number>;
    expect(scores.recall).toBeCloseTo(0.8);
    expect(scores.precision).toBeCloseTo(0.9);
    expect(scores.iou).toBeCloseTo(0.7);
    expect(scores.f1).toBeCloseTo(0.85);
  });

  it("completes as completed_with_errors when some questions failed", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const q1 = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 2,
      processedQuestions: 0,
      failedQuestions: 1, // One already failed
    });

    await seedExperimentResult(t, experimentId, q1, {
      recall: 0.5,
      precision: 0.5,
      iou: 0.5,
      f1: 0.5,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId: q1 },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.status).toBe("completed_with_errors");
  });

  it("marks as canceled when canceling and all handled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "canceling",
      totalQuestions: 1,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "canceled" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.status).toBe("canceled");
    expect(exp!.completedAt).toBeDefined();
  });

  it("ignores callback if experiment is already canceled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "canceled",
      totalQuestions: 2,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.processedQuestions).toBe(0);
  });

  it("returns early when totalQuestions is 0 (S1)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const questionId = await seedQuestion(t, datasetId, 1);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      totalQuestions: 0,
    });

    await t.mutation(internal.experiments.onQuestionEvaluated, {
      workId: "w_fake",
      context: { experimentId, questionId },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    // Should remain unchanged
    expect(exp!.processedQuestions).toBe(0);
    expect(exp!.status).toBe("running");
  });
});

describe("experiments: get query", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("returns null for wrong org (C3)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    const experimentId = await t.run(async (ctx) => {
      return await ctx.db.insert("experiments", {
        orgId: "org_different",
        datasetId,
        name: "Other Org Experiment",
        metricNames: ["recall"],
        status: "completed" as any,
        createdBy: userId,
        createdAt: Date.now(),
      });
    });

    const authedT = t.withIdentity(testIdentity);
    const exp = await authedT.query(internal.experiments.get, { id: experimentId });
    expect(exp).toBeNull();
  });

  it("returns experiment for correct org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const experimentId = await seedExperiment(t, userId, datasetId);

    const authedT = t.withIdentity(testIdentity);
    const exp = await authedT.query(internal.experiments.get, { id: experimentId });
    expect(exp).not.toBeNull();
    expect(exp!.name).toBe("Test Experiment");
  });
});
