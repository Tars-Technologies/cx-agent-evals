import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

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

async function seedAnalysis(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  orgId: string = TEST_ORG_ID,
): Promise<Id<"errorAnalyses">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("errorAnalyses", {
      orgId,
      agentId,
      name: "test analysis",
      origin: { kind: "custom" },
      createdAt: Date.now(),
    }),
  );
}

async function seedConv(t: ReturnType<typeof setupTest>, agentId: Id<"agents">) {
  return await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source: "playground" as const,
      createdAt: Date.now(),
    }),
  );
}

describe("spawnJudge.fromFailureMode", () => {
  it("creates llm_judge with source.kind=error_analysis + failureModeId in dimension", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId,
      errorAnalysisId: eaId,
      name: "promo confusion",
      description: "agent confuses promo codes",
    });

    const evalId = await t.withIdentity(testIdentity).mutation(
      api.evaluator.spawnJudge.fromFailureMode,
      { failureModeId: fmId },
    );

    const row = await t.run(async (ctx) => ctx.db.get(evalId));
    expect(row?.type).toBe("llm_judge");
    expect(row?.source).toEqual({
      kind: "error_analysis",
      failureModeId: fmId,
      errorAnalysisId: eaId,
    });
    expect(row?.llmJudgeConfig?.dimensions).toHaveLength(1);
    expect(row?.llmJudgeConfig?.dimensions[0].failureModeId).toBe(fmId);
    expect(row?.status).toBe("draft");
    expect(row?.splitConfig).toEqual({ trainPct: 0.6, devPct: 0.2, testPct: 0.2 });
  });

  it("inherits FAIL labels from failure mode members and PASS labels from non-members annotated for the agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const eaId = await seedAnalysis(t, agentId);
    const convIds: Id<"conversations">[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await seedConv(t, agentId);
      convIds.push(c);
      await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsertWithAutoContainer, {
        agentId,
        hint: { kind: "analysis", errorAnalysisId: eaId },
        source: { kind: "conversation", conversationId: c },
        rating: i < 2 ? "bad" : "good_enough",
        tags: [],
      });
    }

    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId,
      errorAnalysisId: eaId,
      name: "x",
      description: "",
    });
    for (const c of convIds.slice(0, 2)) {
      await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
        failureModeId: fmId,
        source: { kind: "conversation", conversationId: c },
      });
    }

    const evalId = await t.withIdentity(testIdentity).mutation(
      api.evaluator.spawnJudge.fromFailureMode,
      { failureModeId: fmId },
    );

    const labels = await t.withIdentity(testIdentity).query(api.evaluator.labels.byEvaluator, {
      evaluatorId: evalId,
    });
    expect(labels).toHaveLength(5);
    const fails = labels.filter((l: any) => l.humanLabel === "fail");
    const passes = labels.filter((l: any) => l.humanLabel === "pass");
    expect(fails).toHaveLength(2);
    expect(passes).toHaveLength(3);
    for (const l of labels) {
      expect(["train", "dev", "test"]).toContain(l.splitAssignment);
      expect(l.failureModeId).toBe(fmId);
    }
    for (const f of fails) expect(f.origin).toMatchObject({ kind: "axial_coding", failureModeId: fmId });
    for (const p of passes) expect(p.origin).toEqual({ kind: "inferred_negative" });
  });

  it("split assignment is deterministic given the same seed", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const eaId = await seedAnalysis(t, agentId);
    const convIds: Id<"conversations">[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await seedConv(t, agentId);
      convIds.push(c);
      await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsertWithAutoContainer, {
        agentId,
        hint: { kind: "analysis", errorAnalysisId: eaId },
        source: { kind: "conversation", conversationId: c },
        rating: "bad",
        tags: [],
      });
    }
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId,
      errorAnalysisId: eaId,
      name: "x",
      description: "",
    });
    for (const c of convIds.slice(0, 3)) {
      await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
        failureModeId: fmId,
        source: { kind: "conversation", conversationId: c },
      });
    }

    const evalA = await t.withIdentity(testIdentity).mutation(
      api.evaluator.spawnJudge.fromFailureMode,
      { failureModeId: fmId, splitSeed: 42 },
    );
    const labelsA = await t.withIdentity(testIdentity).query(api.evaluator.labels.byEvaluator, {
      evaluatorId: evalA,
    });

    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.remove, { id: evalA });

    const evalB = await t.withIdentity(testIdentity).mutation(
      api.evaluator.spawnJudge.fromFailureMode,
      { failureModeId: fmId, splitSeed: 42 },
    );
    const labelsB = await t.withIdentity(testIdentity).query(api.evaluator.labels.byEvaluator, {
      evaluatorId: evalB,
    });

    const keyOf = (l: any) =>
      l.source.kind === "conversation" ? l.source.conversationId.toString() : l.source.transcriptId.toString();
    const a = [...labelsA].sort((x, y) => keyOf(x).localeCompare(keyOf(y)));
    const b = [...labelsB].sort((x, y) => keyOf(x).localeCompare(keyOf(y)));
    for (let i = 0; i < a.length; i++) {
      expect(b[i].splitAssignment).toBe(a[i].splitAssignment);
    }
  });

  it("rubricOverride and nameOverride win when provided", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId,
      errorAnalysisId: eaId,
      name: "original",
      description: "auto rubric",
    });

    const evalId = await t.withIdentity(testIdentity).mutation(
      api.evaluator.spawnJudge.fromFailureMode,
      {
        failureModeId: fmId,
        nameOverride: "renamed",
        rubricOverride: "custom rubric",
      },
    );
    const row = await t.run(async (ctx) => ctx.db.get(evalId));
    expect(row?.name).toBe("renamed");
    expect(row?.llmJudgeConfig?.dimensions[0].rubric).toBe("custom rubric");
  });

  it("rejects spawn for failure mode not in user's org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const foreignEa = await seedAnalysis(t, agentId, "org_other");
    const foreignFm = await t.run(async (ctx) =>
      ctx.db.insert("failureModes", {
        orgId: "org_other",
        agentId,
        errorAnalysisId: foreignEa,
        name: "x",
        description: "",
        order: 0,
        createdAt: Date.now(),
      }),
    );
    await expect(
      t.withIdentity(testIdentity).mutation(api.evaluator.spawnJudge.fromFailureMode, {
        failureModeId: foreignFm,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
