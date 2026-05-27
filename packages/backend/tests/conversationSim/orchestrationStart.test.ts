import { describe, test, expect } from "vitest";
import { setupTest, seedUser, seedKB, TEST_ORG_ID, testIdentity } from "../helpers";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// ─── Shared seeders ───

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
 * Seed a scenarioSet with a placeholder job (same pattern as scenarioSets.test.ts).
 */
async function seedSet(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
): Promise<Id<"scenarioSets">> {
  return await t.run(async (ctx) => {
    const fakeJobId = "99999;scenarioGenJobs" as unknown as Id<"scenarioGenJobs">;
    const setId = await ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "Test set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 5 },
      scenarioCount: 0,
      generationJobId: fakeJobId,
      createdAt: Date.now(),
    });

    const jobId = await ctx.db.insert("scenarioGenJobs", {
      orgId: TEST_ORG_ID,
      agentId,
      scenarioSetId: setId,
      status: "running" as const,
      targetCount: 5,
      generatedCount: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(setId, { generationJobId: jobId });
    return setId;
  });
}

/**
 * Insert N scenario rows into a given set.
 */
async function seedScenarios(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  setId: Id<"scenarioSets">,
  kbId: Id<"knowledgeBases">,
  count: number,
): Promise<void> {
  await t.run(async (ctx) => {
    const base = {
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
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("conversationScenarios", { ...base, topic: `topic_${i}` });
    }
  });
}

// ─── Tests ───

describe("orchestration.start with scenarioSetId", () => {
  test("throws when scenarioSetId doesn't belong to the agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentA = await seedAgent(t, userId);
    const agentB = await seedAgent(t, userId);
    const kbId = await seedKB(t, userId);

    const setA = await seedSet(t, agentA);
    await seedScenarios(t, agentA, setA, kbId, 2);

    // Call start with agentB but setA (which belongs to agentA)
    await expect(
      t.withIdentity(testIdentity).mutation(api.conversationSim.orchestration.start, {
        agentId: agentB,
        scenarioSetId: setA,
        k: 1,
      }),
    ).rejects.toThrow(/Scenario set not found/i);
  });

  test("loads scenarios from the set, not from the agent — totalRuns uses set scenario count", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentA = await seedAgent(t, userId);
    const kbId = await seedKB(t, userId);

    // setX has 3 scenarios, setY has 2 scenarios (same agent)
    const setX = await seedSet(t, agentA);
    const setY = await seedSet(t, agentA);
    await seedScenarios(t, agentA, setX, kbId, 3);
    await seedScenarios(t, agentA, setY, kbId, 2);

    const simulationId = await t.withIdentity(testIdentity).mutation(
      api.conversationSim.orchestration.start,
      {
        agentId: agentA,
        scenarioSetId: setX,
        k: 1,
      },
    );

    const sim = await t.run(async (ctx) => ctx.db.get(simulationId));
    expect(sim).not.toBeNull();
    expect(sim?.totalRuns).toBe(3); // NOT 5 (which would be all agent scenarios)
    expect(sim?.scenarioSetId).toBe(setX);
  });

  test("throws when the scenario set has no scenarios", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const emptySet = await seedSet(t, agentId);
    // No scenarios seeded

    await expect(
      t.withIdentity(testIdentity).mutation(api.conversationSim.orchestration.start, {
        agentId,
        scenarioSetId: emptySet,
        k: 1,
      }),
    ).rejects.toThrow(/no scenarios/i);
  });
});
