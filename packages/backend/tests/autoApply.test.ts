import { describe, it, expect } from "vitest";
import { setupTest, seedUser, seedKB, testIdentity, TEST_ORG_ID } from "./helpers";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

async function seedAgent(
  t: ReturnType<typeof setupTest>,
): Promise<Id<"agents">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agents", {
      orgId: TEST_ORG_ID,
      name: "Test Agent",
      identity: {
        agentName: "Bot",
        companyName: "Corp",
        roleDescription: "Helper",
      },
      guardrails: {},
      responseStyle: {},
      model: "claude-sonnet-4-20250514",
      enableReflection: false,
      retrieverIds: [],
      status: "ready",
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
      name: "test set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 1 },
      scenarioCount: 0,
      createdAt: Date.now(),
    }),
  );
}

async function seedSimRunWithConversation(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  agentId: Id<"agents">,
  scenarioSetId: Id<"scenarioSets">,
  kbId: Id<"knowledgeBases">,
) {
  const simId = await t.run(async (ctx) =>
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
  const convId = await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source: "simulation" as const,
      createdAt: Date.now(),
    }),
  );
  const scenarioId = await t.run(async (ctx) =>
    ctx.db.insert("conversationScenarios", {
      orgId: TEST_ORG_ID,
      agentId,
      scenarioSetId,
      source: { kind: "synthetic" as const, kbId },
      persona: {
        type: "x",
        traits: [],
        communicationStyle: "x",
        patienceLevel: "low" as const,
      },
      topic: "t",
      intent: "i",
      complexity: "low" as const,
      reasonForContact: "r",
      knownInfo: "k",
      unknownInfo: "u",
      instruction: "in",
      createdAt: Date.now(),
    }),
  );
  const runId = await t.run(async (ctx) =>
    ctx.db.insert("conversationSimRuns", {
      simulationId: simId,
      scenarioId,
      agentId,
      kIndex: 0,
      seed: 1,
      conversationId: convId,
      status: "completed" as const,
    }),
  );
  return { simId, runId, convId };
}

describe("autoApply ready evaluators on sim run completion", () => {
  it("scores code evaluator (string_contains) and writes evaluatorResults entry on sim run", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);
    const { runId, convId } = await seedSimRunWithConversation(t, userId, agentId, scenarioSetId, kbId);

    // Seed messages: assistant says "We cannot help with that"
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "user" as const,
        content: "I want to cancel",
        status: "complete" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 1,
        role: "assistant" as const,
        content: "We cannot help with that",
        status: "complete" as const,
        createdAt: Date.now(),
      });
    });

    // Create + mark ready a code evaluator
    const evalId = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId,
      name: "no refusal",
      description: "",
      type: "code",
      codeJudgeConfig: {
        checkType: "string_contains",
        params: { needle: "cannot help", expectPresent: false, role: "assistant" },
      },
      source: { kind: "manual" },
      tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.updateStatus, {
      id: evalId,
      status: "ready",
    });

    await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
      simRunId: runId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(runId));
    expect(row?.evaluatorResults).toHaveLength(1);
    expect(row?.evaluatorResults?.[0].evaluatorId).toBe(evalId);
    expect(row?.evaluatorResults?.[0].passed).toBe(false);
    expect(row?.evaluatorResults?.[0].justification).toContain("cannot help");
  });

  it("only applies evaluators with status=ready (skips draft/calibrating/validated)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);
    const { runId, convId } = await seedSimRunWithConversation(t, userId, agentId, scenarioSetId, kbId);
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "assistant" as const,
        content: "hi",
        status: "complete" as const,
        createdAt: Date.now(),
      });
    });

    const draftId = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId,
      name: "d",
      description: "",
      type: "code",
      codeJudgeConfig: {
        checkType: "string_contains",
        params: { needle: "x", expectPresent: true },
      },
      source: { kind: "manual" },
      tags: [],
    });
    const readyId = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId,
      name: "r",
      description: "",
      type: "code",
      codeJudgeConfig: {
        checkType: "string_contains",
        params: { needle: "hi", expectPresent: true },
      },
      source: { kind: "manual" },
      tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.updateStatus, {
      id: readyId,
      status: "ready",
    });

    await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
      simRunId: runId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(runId));
    expect(row?.evaluatorResults).toHaveLength(1);
    expect(row?.evaluatorResults?.[0].evaluatorId).toBe(readyId);
    expect(row?.evaluatorResults?.[0].evaluatorId).not.toBe(draftId);
  });

  it("llm_judge evaluator records a stub result (real scoring deferred)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);
    const { runId } = await seedSimRunWithConversation(t, userId, agentId, scenarioSetId, kbId);

    const evalId = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId,
      name: "tone",
      description: "",
      type: "llm_judge",
      llmJudgeConfig: {
        dimensions: [
          { name: "tone", rubric: "polite", passExamples: [], failExamples: [] },
        ],
        outputFormat: "per_dimension",
        model: "gpt-4o-mini",
        inputContext: ["transcript"],
      },
      source: { kind: "manual" },
      tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.updateStatus, {
      id: evalId,
      status: "ready",
    });

    await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
      simRunId: runId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(runId));
    expect(row?.evaluatorResults).toHaveLength(1);
    expect(row?.evaluatorResults?.[0].justification).toMatch(/stub|pending/i);
  });

  it("no-op when sim run lacks conversationId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const kbId = await seedKB(t, userId);
    const scenarioSetId = await seedScenarioSet(t, agentId);

    const simId = await t.run(async (ctx) =>
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
    const scenarioId = await t.run(async (ctx) =>
      ctx.db.insert("conversationScenarios", {
        orgId: TEST_ORG_ID,
        agentId,
        scenarioSetId,
        source: { kind: "synthetic" as const, kbId },
        persona: {
          type: "x",
          traits: [],
          communicationStyle: "x",
          patienceLevel: "low" as const,
        },
        topic: "t",
        intent: "i",
        complexity: "low" as const,
        reasonForContact: "r",
        knownInfo: "k",
        unknownInfo: "u",
        instruction: "in",
        createdAt: Date.now(),
      }),
    );
    const runId = await t.run(async (ctx) =>
      ctx.db.insert("conversationSimRuns", {
        simulationId: simId,
        scenarioId,
        agentId,
        kIndex: 0,
        seed: 1,
        status: "pending" as const,
      }),
    );

    await expect(
      t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
        simRunId: runId,
      }),
    ).resolves.not.toThrow();

    const row = await t.run(async (ctx) => ctx.db.get(runId));
    expect(row?.evaluatorResults).toBeUndefined();
  });
});
