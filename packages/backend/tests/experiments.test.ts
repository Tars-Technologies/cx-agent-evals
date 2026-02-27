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
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

// ─── Tests ───

describe("experiments: onExperimentComplete", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("does nothing on success (action marks experiment complete)", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "completed",
      phase: "done",
    });

    await t.mutation(internal.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "success", returnValue: {} },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    // Status should remain "completed" — action already handled it
    expect(exp!.status).toBe("completed");
  });

  it("marks experiment as failed when action fails", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "running",
    });

    await t.mutation(internal.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Action timed out" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.status).toBe("failed");
    expect(exp!.error).toBe("Action timed out");
    expect(exp!.completedAt).toBeDefined();
  });

  it("marks experiment as canceled when WorkPool item is canceled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "canceling",
    });

    await t.mutation(internal.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "canceled" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    expect(exp!.status).toBe("canceled");
    expect(exp!.completedAt).toBeDefined();
  });

  it("does not overwrite if experiment already marked failed by action", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const experimentId = await seedExperiment(t, userId, datasetId, {
      status: "failed",
    });

    await t.mutation(internal.experiments.onExperimentComplete, {
      workId: "w_fake",
      context: { experimentId },
      result: { kind: "failed", error: "Duplicate failure" },
    });

    const exp = await t.run(async (ctx) => ctx.db.get(experimentId));
    // Should not overwrite — status was already "failed"
    expect(exp!.status).toBe("failed");
    expect(exp!.error).toBeUndefined(); // Original had no error set
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
