import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  TEST_ORG_ID,
  testIdentity,
  setupTest,
  seedUser,
  seedKB,
  seedDataset,
} from "./helpers";

const OTHER_ORG_ID = "org_other999";
const OTHER_CLERK_ID = "user_other999";
const otherIdentity = {
  subject: OTHER_CLERK_ID,
  issuer: "https://test.clerk.com",
  org_id: OTHER_ORG_ID,
  org_role: "org:admin",
};

async function seedExperiment(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  datasetId: Id<"datasets">,
  orgId: string = TEST_ORG_ID,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("experiments", {
      orgId,
      datasetId,
      name: "Test Experiment",
      metricNames: [],
      status: "completed" as const,
      experimentType: "agent" as const,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedQuestion(
  t: ReturnType<typeof convexTest>,
  datasetId: Id<"datasets">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("questions", {
      datasetId,
      queryId: "q1",
      queryText: "What is X?",
      sourceDocId: "doc1",
      relevantSpans: [],
      metadata: {},
    });
  });
}

async function seedFailureMode(
  t: ReturnType<typeof convexTest>,
  experimentId: Id<"experiments">,
  orgId: string = TEST_ORG_ID,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("failureModes", {
      orgId,
      experimentId,
      name: "Hallucinated citation",
      description: "Made up a fact",
      order: 0,
      createdAt: Date.now(),
    });
  });
}

describe("failureModes.assignQuestion — cross-org guards", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("rejects mapping to a failure mode belonging to a different org", async () => {
    // Seed org A's experiment + question
    const userA = await seedUser(t);
    const kbA = await seedKB(t, userA);
    const dsA = await seedDataset(t, userA, kbA);
    const expA = await seedExperiment(t, userA, dsA, TEST_ORG_ID);
    const qA = await seedQuestion(t, dsA);

    // Seed org B's failure mode (on its own experiment)
    const userB = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        clerkId: OTHER_CLERK_ID,
        email: "other@test.com",
        name: "Other User",
        createdAt: Date.now(),
      }),
    );
    const kbB = await t.run(async (ctx) =>
      ctx.db.insert("knowledgeBases", {
        orgId: OTHER_ORG_ID,
        name: "Other KB",
        metadata: {},
        createdBy: userB,
        createdAt: Date.now(),
      }),
    );
    const dsB = await t.run(async (ctx) =>
      ctx.db.insert("datasets", {
        orgId: OTHER_ORG_ID,
        kbId: kbB,
        name: "Other Dataset",
        strategy: "simple",
        strategyConfig: {},
        questionCount: 0,
        metadata: {},
        createdBy: userB,
        createdAt: Date.now(),
      }),
    );
    const expB = await seedExperiment(t, userB, dsB, OTHER_ORG_ID);
    const fmB = await seedFailureMode(t, expB, OTHER_ORG_ID);

    // User from org A tries to assign their question to org B's failure mode
    const asUserA = t.withIdentity(testIdentity);
    await expect(
      asUserA.mutation(api.failureModes.crud.assignQuestion, {
        failureModeId: fmB,
        questionId: qA,
        experimentId: expA,
      }),
    ).rejects.toThrow(/Failure mode not found/);

    // No mapping should have been created
    const mappings = await t.run(async (ctx) =>
      ctx.db.query("failureModeQuestionMappings").collect(),
    );
    expect(mappings).toHaveLength(0);
  });

  it("rejects assigning to a failure mode from a different experiment in the same org", async () => {
    const userA = await seedUser(t);
    const kbA = await seedKB(t, userA);
    const dsA = await seedDataset(t, userA, kbA);
    const exp1 = await seedExperiment(t, userA, dsA, TEST_ORG_ID);
    const exp2 = await seedExperiment(t, userA, dsA, TEST_ORG_ID);
    const qA = await seedQuestion(t, dsA);
    // Failure mode belongs to experiment 2
    const fmExp2 = await seedFailureMode(t, exp2, TEST_ORG_ID);

    const asUserA = t.withIdentity(testIdentity);
    // Try to assign using experiment 1's ID but fmExp2
    await expect(
      asUserA.mutation(api.failureModes.crud.assignQuestion, {
        failureModeId: fmExp2,
        questionId: qA,
        experimentId: exp1,
      }),
    ).rejects.toThrow(/does not belong to this experiment/);
  });

  it("accepts an in-org, same-experiment assignment", async () => {
    const userA = await seedUser(t);
    const kbA = await seedKB(t, userA);
    const dsA = await seedDataset(t, userA, kbA);
    const expA = await seedExperiment(t, userA, dsA, TEST_ORG_ID);
    const fmA = await seedFailureMode(t, expA, TEST_ORG_ID);
    const qA = await seedQuestion(t, dsA);

    const asUserA = t.withIdentity(testIdentity);
    await asUserA.mutation(api.failureModes.crud.assignQuestion, {
      failureModeId: fmA,
      questionId: qA,
      experimentId: expA,
    });

    const mappings = await t.run(async (ctx) =>
      ctx.db.query("failureModeQuestionMappings").collect(),
    );
    expect(mappings).toHaveLength(1);
    expect(mappings[0].orgId).toBe(TEST_ORG_ID);
    expect(mappings[0].failureModeId).toBe(fmA);
    expect(mappings[0].questionId).toBe(qA);
  });
});

describe("failureModes.startGeneration — concurrency guard", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("rejects when failure modes already exist for the experiment", async () => {
    const userA = await seedUser(t);
    const kbA = await seedKB(t, userA);
    const dsA = await seedDataset(t, userA, kbA);
    const expA = await seedExperiment(t, userA, dsA, TEST_ORG_ID);
    // Pre-existing failure mode — simulating a prior Generate run
    await seedFailureMode(t, expA, TEST_ORG_ID);

    const asUserA = t.withIdentity(testIdentity);
    await expect(
      asUserA.mutation(api.failureModes.crud.startGeneration, {
        experimentId: expA,
      }),
    ).rejects.toThrow(/already exist/);
  });
});
