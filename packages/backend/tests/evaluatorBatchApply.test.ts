import { describe, it, expect, vi } from "vitest";
import { setupTest, seedUser, seedKB, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: async (args: any) => {
            // The conversation transcript lives in the user-role prompt message;
            // judge "pass" iff it contains the GOOD marker.
            const transcript = args.messages
              .filter((m: any) => m.role === "user")
              .map((m: any) => m.content)
              .join("\n");
            const answer = transcript.includes("GOOD") ? "pass" : "fail";
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

interface SeedOpts {
  goodCount: number;
  badCount: number;
  validated: { tpr: number; tnr: number } | null;
  /**
   * When true, seed a "ready" evaluator with devMetrics but NO testMetrics
   * (simulates validation that had no test-split labels). Requires `validated`.
   */
  devOnly?: boolean;
}

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
      model: "gpt-4o-mini",
      enableReflection: false,
      retrieverIds: [],
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

async function seedConversation(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  good: boolean,
): Promise<Id<"conversations">> {
  const text = good ? "this is GOOD work" : "this is bad work";
  return await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source: "simulation" as const,
      createdAt: Date.now(),
    });
    await ctx.db.insert("messages", {
      conversationId: convId,
      order: 0,
      role: "user" as const,
      content: text,
      status: "complete" as const,
      createdAt: Date.now(),
    });
    return convId;
  });
}

async function seedCohortAndJudge(
  t: ReturnType<typeof setupTest>,
  opts: SeedOpts,
): Promise<{
  agentId: Id<"agents">;
  simulationId: Id<"conversationSimulations">;
  evaluatorId: Id<"evaluators">;
  calibrationConvId: Id<"conversations">;
}> {
  const userId = await seedUser(t);
  const agentId = await seedAgent(t);
  const kbId = await seedKB(t, userId);

  // Minimal scenario set + scenario (sim runs require a scenarioId).
  const scenarioSetId = await t.run(async (ctx) =>
    ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 1 },
      scenarioCount: 1,
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
        type: "customer",
        traits: [],
        communicationStyle: "neutral",
        patienceLevel: "medium" as const,
      },
      topic: "topic",
      intent: "intent",
      complexity: "low" as const,
      reasonForContact: "reason",
      knownInfo: "",
      unknownInfo: "",
      instruction: "",
      createdAt: Date.now(),
    }),
  );

  const simulationId = await t.run(async (ctx) =>
    ctx.db.insert("conversationSimulations", {
      orgId: TEST_ORG_ID,
      userId,
      agentId,
      scenarioSetId,
      k: 1,
      concurrency: 1,
      maxTurns: 5,
      timeoutMs: 120000,
      userSimModel: "claude-sonnet-4-20250514",
      status: "completed" as const,
      totalRuns: opts.goodCount + opts.badCount + 1,
      completedRuns: opts.goodCount + opts.badCount + 1,
      failedRuns: 0,
    }),
  );

  const seedRun = async (conversationId: Id<"conversations">) => {
    await t.run(async (ctx) =>
      ctx.db.insert("conversationSimRuns", {
        simulationId,
        scenarioId,
        agentId,
        kIndex: 0,
        seed: 1,
        conversationId,
        status: "completed" as const,
      }),
    );
  };

  for (let i = 0; i < opts.goodCount; i++) {
    const convId = await seedConversation(t, agentId, true);
    await seedRun(convId);
  }
  for (let i = 0; i < opts.badCount; i++) {
    const convId = await seedConversation(t, agentId, false);
    await seedRun(convId);
  }

  // Calibration conversation: appears in the cohort as a completed sim run AND
  // as a labeled (calibration) conversation for the judge → must be excluded.
  const calibrationConvId = await seedConversation(t, agentId, true);
  await seedRun(calibrationConvId);

  // Evaluator (llm_judge).
  const validated = opts.validated;
  const evaluatorId = await t.run(async (ctx) =>
    ctx.db.insert("evaluators", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "honest judge",
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
      status: validated ? ("ready" as const) : ("draft" as const),
      tags: [],
      createdAt: Date.now(),
      splitSeed: 42,
      ...(validated
        ? {
            devMetrics: {
              tpr: validated.tpr,
              tnr: validated.tnr,
              agreement: (validated.tpr + validated.tnr) / 2,
            },
            // devOnly: status "ready" + devMetrics but NO testMetrics (no test split).
            ...(opts.devOnly
              ? {}
              : {
                  testMetrics: {
                    tpr: validated.tpr,
                    tnr: validated.tnr,
                    agreement: (validated.tpr + validated.tnr) / 2,
                    n: 10,
                  },
                  // Exercise the exact-counts path in reconstructPairs. With a
                  // 5/5 test split these match round(n/2), so the existing
                  // assertions (n=4, observed 0.75, corrected true/false) hold.
                  labelCounts: { passDev: 5, failDev: 5, passTest: 5, failTest: 5 },
                }),
          }
        : {}),
    }),
  );

  // Register the calibration conversation as a label for the judge.
  await t.run(async (ctx) =>
    ctx.db.insert("evaluatorLabels", {
      orgId: TEST_ORG_ID,
      evaluatorId,
      source: { kind: "conversation" as const, conversationId: calibrationConvId },
      humanLabel: "pass" as const,
      splitAssignment: "test" as const,
      origin: { kind: "calibration_pass" as const },
      ratedBy: userId,
      createdAt: Date.now(),
    }),
  );

  return { agentId, simulationId, evaluatorId, calibrationConvId };
}

describe("batchApply.runOnCohort (Score B)", () => {
  it("computes corrected Score B and excludes the calibration set", async () => {
    const t = setupTest();
    const { simulationId, evaluatorId, calibrationConvId } = await seedCohortAndJudge(t, {
      goodCount: 3,
      badCount: 1,
      validated: { tpr: 0.9, tnr: 0.9 },
    });
    const res = await t.withIdentity(testIdentity).action(api.evaluator.batchApply.runOnCohort, {
      evaluatorIds: [evaluatorId],
      cohort: { kind: "simulation", simulationId },
    });
    expect(res.runs).toHaveLength(1);
    expect(res.runs[0].n).toBe(4); // calibration conv excluded
    expect(res.runs[0].observedPassRate).toBeCloseTo(0.75, 5);
    expect(res.runs[0].corrected).toBe(true);

    const runRow = await t.run(async (ctx) =>
      ctx.db
        .query("evaluationRuns")
        .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evaluatorId))
        .first(),
    );
    expect(runRow).not.toBeNull();
    const results = await t.run(async (ctx) =>
      ctx.db
        .query("evaluationResults")
        .withIndex("by_run", (q) => q.eq("evaluationRunId", runRow!._id))
        .collect(),
    );
    const measuredConvIds = results.map((r: any) =>
      r.source.kind === "conversation" ? r.source.conversationId : null,
    );
    expect(measuredConvIds).not.toContain(calibrationConvId);
  });

  it("marks Score B uncorrected when the judge is not validated", async () => {
    const t = setupTest();
    const { simulationId, evaluatorId } = await seedCohortAndJudge(t, {
      goodCount: 2,
      badCount: 2,
      validated: null,
    });
    const res = await t.withIdentity(testIdentity).action(api.evaluator.batchApply.runOnCohort, {
      evaluatorIds: [evaluatorId],
      cohort: { kind: "simulation", simulationId },
    });
    expect(res.runs[0].corrected).toBe(false);
  });

  it("does not claim a corrected score when only devMetrics exist (no test split)", async () => {
    const t = setupTest();
    const { simulationId, evaluatorId } = await seedCohortAndJudge(t, {
      goodCount: 3,
      badCount: 1,
      validated: { tpr: 0.9, tnr: 0.9 },
      devOnly: true,
    });
    const res = await t.withIdentity(testIdentity).action(api.evaluator.batchApply.runOnCohort, {
      evaluatorIds: [evaluatorId],
      cohort: { kind: "simulation", simulationId },
    });
    expect(res.runs[0].corrected).toBe(false);
    expect(res.runs[0].ci).toEqual({ lower: 0, upper: 1 });
  });

  it("scorecardBySimulation returns per-evaluator rows + overall mean", async () => {
    const t = setupTest();
    const { simulationId, evaluatorId } = await seedCohortAndJudge(t, {
      goodCount: 3, badCount: 1, validated: { tpr: 0.9, tnr: 0.9 },
    });
    await t.withIdentity(testIdentity).action(api.evaluator.batchApply.runOnCohort, {
      evaluatorIds: [evaluatorId],
      cohort: { kind: "simulation", simulationId },
    });
    const card = await t.withIdentity(testIdentity).query(
      api.evaluator.evaluationRuns.scorecardBySimulation,
      { simulationId },
    );
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0].evaluatorId).toBe(evaluatorId);
    expect(typeof card.overall.correctedPassRate).toBe("number");
  });
});
