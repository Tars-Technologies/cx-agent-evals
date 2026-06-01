import { describe, it, expect, vi } from "vitest";
import { setupTest, seedUser, seedKB, testIdentity, TEST_ORG_ID } from "./helpers";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: async (args: any) => {
            // The transcript under test lives in the user message; the system
            // message carries the rubric + few-shot examples. Judge on the
            // transcript only so few-shot pass examples don't leak the marker.
            const userText = args.messages
              .filter((m: any) => m.role === "user")
              .map((m: any) => m.content)
              .join("\n");
            const answer = userText.includes("GOOD") ? "pass" : "fail";
            return {
              choices: [
                { message: { content: JSON.stringify({ answer, reasoning: "mock" }) } },
              ],
            };
          },
        },
      };
    },
  };
});

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

/**
 * Seed a READY llm_judge evaluator for a sim's agent plus a completed sim run
 * whose conversation transcript contains "GOOD" when `good` is true. The judge
 * also gets a couple of train labels so few-shot building exercises the real
 * label → source → messages path.
 */
async function seedReadyLlmJudgeAndSimRun(
  t: ReturnType<typeof setupTest>,
  { good }: { good: boolean },
): Promise<{ runId: Id<"conversationSimRuns">; agentId: Id<"agents">; evaluatorId: Id<"evaluators"> }> {
  const userId = await seedUser(t);
  const agentId = await seedAgent(t);
  const kbId = await seedKB(t, userId);
  const scenarioSetId = await seedScenarioSet(t, agentId);
  const { runId, convId } = await seedSimRunWithConversation(
    t,
    userId,
    agentId,
    scenarioSetId,
    kbId,
  );

  // Transcript under evaluation. Marker only in the user (transcript) message.
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", {
      conversationId: convId,
      order: 0,
      role: "user" as const,
      content: good ? "This was GOOD service" : "This was bad service",
      status: "complete" as const,
      createdAt: Date.now(),
    });
    await ctx.db.insert("messages", {
      conversationId: convId,
      order: 1,
      role: "assistant" as const,
      content: "Thanks for the feedback",
      status: "complete" as const,
      createdAt: Date.now(),
    });
  });

  const evaluatorId = await t.run(async (ctx) =>
    ctx.db.insert("evaluators", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "llm refund judge",
      description: "",
      type: "llm_judge" as const,
      llmJudgeConfig: {
        dimensions: [
          { name: "quality", rubric: "respond well", passExamples: [], failExamples: [] },
        ],
        outputFormat: "per_dimension" as const,
        model: "gpt-4o-mini",
        inputContext: ["transcript" as const],
      },
      source: { kind: "manual" as const },
      status: "ready" as const,
      tags: [],
      createdAt: Date.now(),
      splitSeed: 42,
    }),
  );

  // A balanced pair of train labels (pass + fail) backed by conversations.
  const makeTrainLabel = async (humanLabel: "pass" | "fail") => {
    const labelConvId = await t.run(async (ctx) => {
      const c = await ctx.db.insert("conversations", {
        orgId: TEST_ORG_ID,
        agentIds: [agentId],
        status: "active" as const,
        source: "playground" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("messages", {
        conversationId: c,
        order: 0,
        role: "assistant" as const,
        content: humanLabel === "pass" ? "exemplary GOOD reply" : "weak reply",
        status: "complete" as const,
        createdAt: Date.now(),
      });
      return c;
    });
    await t.run(async (ctx) =>
      ctx.db.insert("evaluatorLabels", {
        orgId: TEST_ORG_ID,
        evaluatorId,
        source: { kind: "conversation" as const, conversationId: labelConvId },
        humanLabel,
        splitAssignment: "train" as const,
        origin:
          humanLabel === "pass"
            ? { kind: "calibration_pass" as const }
            : { kind: "inferred_negative" as const },
        ratedBy: userId,
        createdAt: Date.now(),
      }),
    );
  };
  await makeTrainLabel("pass");
  await makeTrainLabel("fail");

  return { runId, agentId, evaluatorId };
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

  it("applies a ready llm_judge via the LLM client (no stub)", async () => {
    const t = setupTest();
    const { runId } = await seedReadyLlmJudgeAndSimRun(t, { good: true });
    await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
      simRunId: runId,
    });
    const run = await t.run(async (ctx) => ctx.db.get(runId));
    const llm = run!.evaluatorResults!.find((r: any) =>
      r.evaluatorName.toLowerCase().includes("llm"),
    );
    expect(llm).toBeTruthy();
    expect(llm!.passed).toBe(true);
    expect(llm!.justification).not.toContain("[stub]");
  });

  it("ready llm_judge fails when transcript lacks the marker", async () => {
    const t = setupTest();
    const { runId } = await seedReadyLlmJudgeAndSimRun(t, { good: false });
    await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, {
      simRunId: runId,
    });
    const run = await t.run(async (ctx) => ctx.db.get(runId));
    const llm = run!.evaluatorResults!.find((r: any) =>
      r.evaluatorName.toLowerCase().includes("llm"),
    );
    expect(llm).toBeTruthy();
    expect(llm!.passed).toBe(false);
    expect(llm!.justification).not.toContain("[stub]");
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
