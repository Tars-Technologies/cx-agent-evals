import { describe, test, expect } from "vitest";
import { setupTest, seedUser, TEST_ORG_ID } from "../helpers";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

async function seedAgent(
  t: ReturnType<typeof setupTest>,
  _userId: Id<"users">,
): Promise<Id<"agents">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agents", {
      orgId: TEST_ORG_ID,
      name: "test agent",
      identity: {
        agentName: "Test",
        companyName: "Acme",
        roleDescription: "support",
      },
      guardrails: {},
      responseStyle: {},
      model: "gpt-4o-mini",
      enableReflection: false,
      retrieverIds: [],
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
}

/**
 * Break the set↔job circular dependency:
 *   1. Insert a placeholder set with a synthetic fake jobId that passes
 *      convex-test's ID format validation ("N;scenarioGenJobs").
 *   2. Insert the real job row pointing at that set.
 *   3. Patch the placeholder set's generationJobId to the real jobId.
 *
 * The fake ID "99999;scenarioGenJobs" satisfies the validator (correct format
 * and correct table name suffix) but doesn't reference a real document — that
 * is fine because we overwrite it in step 3 before returning.
 */
async function seedJobWithSet(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
): Promise<Id<"scenarioGenJobs">> {
  return await t.run(async (ctx) => {
    // Step 1: insert the set using a fake but format-valid job ID placeholder
    const fakeJobId = "99999;scenarioGenJobs" as unknown as Id<"scenarioGenJobs">;
    const tempSetId = await ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "__seed_placeholder__",
      source: "synthetic" as const,
      generationConfig: { targetCount: 5 },
      scenarioCount: 0,
      generationJobId: fakeJobId,
      createdAt: Date.now(),
    });

    // Step 2: insert the job, pointing at the real set
    const jobId = await ctx.db.insert("scenarioGenJobs", {
      orgId: TEST_ORG_ID,
      agentId,
      scenarioSetId: tempSetId,
      status: "running" as const,
      targetCount: 5,
      generatedCount: 0,
      createdAt: Date.now(),
    });

    // Step 3: patch the placeholder set to point at the real job
    await ctx.db.patch(tempSetId, { generationJobId: jobId });

    return jobId;
  });
}

describe("scenarioSets", () => {
  test("createInternal inserts a set with scenarioCount=0 and a createdAt timestamp", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const jobId = await seedJobWithSet(t, agentId);

    const setId = await t.mutation(
      internal.conversationSim.scenarioSets.createInternal,
      {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Test set",
        source: "synthetic" as const,
        generationConfig: { targetCount: 5 },
        generationJobId: jobId,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(setId));
    expect(row).not.toBeNull();
    expect(row?.scenarioCount).toBe(0);
    expect(row?.name).toBe("Test set");
    expect(row?.orgId).toBe(TEST_ORG_ID);
    expect(row?.agentId).toBe(agentId);
    expect(row?.source).toBe("synthetic");
    expect(typeof row?.createdAt).toBe("number");
    expect(row?.createdAt).toBeGreaterThan(0);
  });

  test("patchCount updates scenarioCount on an existing row", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const jobId = await seedJobWithSet(t, agentId);

    const setId = await t.mutation(
      internal.conversationSim.scenarioSets.createInternal,
      {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Patch test set",
        source: "grounded" as const,
        generationConfig: { targetCount: 10 },
        generationJobId: jobId,
      },
    );

    // Verify initial count is 0
    const before = await t.run(async (ctx) => ctx.db.get(setId));
    expect(before?.scenarioCount).toBe(0);

    // Patch the count
    await t.mutation(internal.conversationSim.scenarioSets.patchCount, {
      id: setId,
      scenarioCount: 7,
    });

    // Verify it updated and other fields are unchanged
    const after = await t.run(async (ctx) => ctx.db.get(setId));
    expect(after?.scenarioCount).toBe(7);
    expect(after?.name).toBe("Patch test set");
    expect(after?.source).toBe("grounded");
  });
});
