import { describe, it, expect } from "vitest";
import { setupTest, seedUser, TEST_ORG_ID } from "./helpers";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

async function seedAgent(t: ReturnType<typeof setupTest>): Promise<Id<"agents">> {
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

async function seedScenarioSet(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
): Promise<Id<"scenarioSets">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 1 },
      scenarioCount: 0,
      createdAt: Date.now(),
    }),
  );
}

async function seedSimulation(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  agentId: Id<"agents">,
): Promise<Id<"conversationSimulations">> {
  const scenarioSetId = await seedScenarioSet(t, agentId);
  return await t.run(async (ctx) =>
    ctx.db.insert("conversationSimulations", {
      orgId: TEST_ORG_ID,
      userId,
      agentId,
      scenarioSetId,
      k: 1,
      concurrency: 1,
      maxTurns: 5,
      timeoutMs: 60000,
      userSimModel: "x",
      status: "running" as const,
      totalRuns: 1,
      completedRuns: 0,
    }),
  );
}

describe("errorAnalysis/members.resolveContainerInternal", () => {
  it("creates a sim-origin container on first call and reuses it on second", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const simulationId = await seedSimulation(t, userId, agentId);

    const id1 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    const id2 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    expect(id1).toBe(id2);
  });

  it("creates a playground container per agent (one only)", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);

    const id1 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "playground" },
    });
    const id2 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "playground" },
    });
    expect(id1).toBe(id2);
  });

  it("passes through analysis hint without creating new", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Existing",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const result = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "analysis", errorAnalysisId: eaId },
    });
    expect(result).toBe(eaId);
  });
});

describe("errorAnalysis/members.addMemberInternal", () => {
  it("is idempotent on repeated calls", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "X",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const conversationId = await t.run(async (ctx) =>
      ctx.db.insert("conversations", {
        orgId: TEST_ORG_ID,
        agentIds: [agentId],
        status: "active" as const,
        source: "playground" as const,
        createdAt: Date.now(),
      }),
    );
    const m1 = await t.mutation(internal.errorAnalysis.members.addMemberInternal, {
      orgId: TEST_ORG_ID,
      errorAnalysisId: eaId,
      source: { kind: "conversation", conversationId },
      addedVia: "annotation",
    });
    const m2 = await t.mutation(internal.errorAnalysis.members.addMemberInternal, {
      orgId: TEST_ORG_ID,
      errorAnalysisId: eaId,
      source: { kind: "conversation", conversationId },
      addedVia: "annotation",
    });
    expect(m1).toBe(m2);
    const all = await t.run((ctx) =>
      ctx.db
        .query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });
});
