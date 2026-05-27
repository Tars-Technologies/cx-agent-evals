import { describe, test, expect } from "vitest";
import { setupTest, seedUser, seedKB, TEST_ORG_ID, testIdentity } from "../helpers";
import { api, internal } from "../../convex/_generated/api";
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

  test("byAgent returns org-scoped sets for the given agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentA = await seedAgent(t, userId);
    const agentB = await seedAgent(t, userId);

    // seedJobWithSet creates one scenarioSets row per call (the placeholder
    // is patched in place, so it stays as the real row). Two calls → 2 sets.
    await seedJobWithSet(t, agentA);
    await seedJobWithSet(t, agentA);

    // One set for agentB
    await seedJobWithSet(t, agentB);

    const setsA = await t.withIdentity(testIdentity).query(
      api.conversationSim.scenarioSets.byAgent,
      { agentId: agentA },
    );
    expect(setsA).toHaveLength(2);
    expect(setsA.every((s) => s.agentId === agentA)).toBe(true);

    const setsB = await t.withIdentity(testIdentity).query(
      api.conversationSim.scenarioSets.byAgent,
      { agentId: agentB },
    );
    expect(setsB).toHaveLength(1);
    expect(setsB[0].agentId).toBe(agentB);
  });

  test("remove deletes set and its scenarios when no simulations reference it", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const kbId = await seedKB(t, userId);
    const jobId = await seedJobWithSet(t, agentId);

    const setId = await t.mutation(
      internal.conversationSim.scenarioSets.createInternal,
      {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Set to remove",
        source: "synthetic" as const,
        generationConfig: { targetCount: 3 },
        generationJobId: jobId,
      },
    );

    // Insert 3 scenarios directly
    await t.run(async (ctx) => {
      const scenarioBase = {
        orgId: TEST_ORG_ID,
        agentId,
        scenarioSetId: setId,
        source: { kind: "synthetic" as const, kbId },
        persona: {
          type: "end_user",
          traits: ["impatient"],
          communicationStyle: "direct",
          patienceLevel: "low" as const,
        },
        topic: "billing",
        intent: "get refund",
        complexity: "low" as const,
        reasonForContact: "overcharged",
        knownInfo: "invoice number",
        unknownInfo: "refund timeline",
        instruction: "ask about refund",
        createdAt: Date.now(),
      };
      await ctx.db.insert("conversationScenarios", scenarioBase);
      await ctx.db.insert("conversationScenarios", { ...scenarioBase, topic: "shipping" });
      await ctx.db.insert("conversationScenarios", { ...scenarioBase, topic: "returns" });
    });

    await t.withIdentity(testIdentity).mutation(
      api.conversationSim.scenarioSets.remove,
      { id: setId },
    );

    const deletedSet = await t.run(async (ctx) => ctx.db.get(setId));
    expect(deletedSet).toBeNull();

    const remainingScenarios = await t.run(async (ctx) =>
      ctx.db
        .query("conversationScenarios")
        .withIndex("by_set", (q) => q.eq("scenarioSetId", setId))
        .collect(),
    );
    expect(remainingScenarios).toHaveLength(0);
  });

  test("remove throws when a simulation references the set", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const jobId = await seedJobWithSet(t, agentId);

    const setId = await t.mutation(
      internal.conversationSim.scenarioSets.createInternal,
      {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Referenced set",
        source: "synthetic" as const,
        generationConfig: { targetCount: 5 },
        generationJobId: jobId,
      },
    );

    // Insert a simulation referencing this set
    await t.run(async (ctx) => {
      await ctx.db.insert("conversationSimulations", {
        orgId: TEST_ORG_ID,
        userId,
        agentId,
        scenarioSetId: setId,
        k: 1,
        concurrency: 1,
        maxTurns: 10,
        timeoutMs: 30000,
        userSimModel: "gpt-4o-mini",
        status: "pending" as const,
        totalRuns: 0,
        completedRuns: 0,
      });
    });

    await expect(
      t.withIdentity(testIdentity).mutation(
        api.conversationSim.scenarioSets.remove,
        { id: setId },
      ),
    ).rejects.toThrow(/Cannot delete.*referenced/);
  });
});
