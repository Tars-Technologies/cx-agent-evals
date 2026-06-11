import { describe, it, expect } from "vitest";
import { internal } from "../../convex/_generated/api";
import { setupTest, seedUser, seedKB, TEST_ORG_ID } from "../helpers";
import type { Id } from "../../convex/_generated/dataModel";

async function seedAgent(t: ReturnType<typeof setupTest>): Promise<Id<"agents">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agents", {
      orgId: TEST_ORG_ID,
      name: "wipe-test agent",
      identity: { agentName: "Bot", companyName: "Acme", roleDescription: "support" },
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

async function seedScenarioSet(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
): Promise<Id<"scenarioSets">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "wipe-test set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 5 },
      scenarioCount: 0,
      createdAt: Date.now(),
    }),
  );
}

describe("conversationSim wipeAll", () => {
  it("deletes all conversationScenarios in a single pass", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);

    // Insert 5 scenarios (below WIPE_BATCH=200, so no reschedule needed)
    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) => {
        await ctx.db.insert("conversationScenarios", {
          orgId: TEST_ORG_ID,
          agentId,
          scenarioSetId,
          source: { kind: "synthetic" as const, kbId },
          persona: {
            type: "Curious customer",
            traits: ["friendly"],
            communicationStyle: "casual",
            patienceLevel: "medium" as const,
          },
          topic: "Account billing",
          intent: "Check balance",
          complexity: "low" as const,
          reasonForContact: "Wants to verify a charge",
          knownInfo: "Has an account",
          unknownInfo: "Exact billing date",
          instruction: "Ask about the charge politely",
          createdAt: Date.now(),
        });
      });
    }

    // Assert rows exist before wiping so the post-wipe assertion is meaningful
    const before = await t.run((ctx) =>
      ctx.db.query("conversationScenarios").collect(),
    );
    expect(before).toHaveLength(5);

    await t.mutation(internal.conversationSim.wipe.wipeAll, {});
    await t.finishInProgressScheduledFunctions();

    const remaining = await t.run((ctx) =>
      ctx.db.query("conversationScenarios").collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("deletes scenarioGenJobs and leaves scenarioSets untouched", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);

    // Seed a scenarioGenJob
    await t.run(async (ctx) =>
      ctx.db.insert("scenarioGenJobs", {
        orgId: TEST_ORG_ID,
        agentId,
        scenarioSetId,
        status: "completed" as const,
        targetCount: 1,
        generatedCount: 1,
        createdAt: Date.now(),
      }),
    );

    // Assert rows exist before wiping so the post-wipe assertions are meaningful
    const [jobsBefore, setsBefore] = await t.run(async (ctx) => [
      await ctx.db.query("scenarioGenJobs").collect(),
      await ctx.db.query("scenarioSets").collect(),
    ]);
    expect(jobsBefore).toHaveLength(1);
    expect(setsBefore).toHaveLength(1);

    await t.mutation(internal.conversationSim.wipe.wipeAll, {});
    await t.finishInProgressScheduledFunctions();

    const [jobs, sets] = await t.run(async (ctx) => [
      await ctx.db.query("scenarioGenJobs").collect(),
      await ctx.db.query("scenarioSets").collect(),
    ]);
    expect(jobs).toHaveLength(0);
    // scenarioSets is NOT in the wipe list — only the sim tables are
    expect(sets).toHaveLength(1);
  });
});
