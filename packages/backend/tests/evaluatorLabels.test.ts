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

const llmJudgeConfig = () => ({
  dimensions: [{ name: "x", rubric: "y", passExamples: [], failExamples: [] }],
  outputFormat: "per_dimension" as const,
  model: "gpt-4o-mini",
  inputContext: ["transcript" as const],
});

async function seedEvaluator(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
) {
  return await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
    agentId,
    name: "j",
    description: "",
    type: "llm_judge",
    llmJudgeConfig: llmJudgeConfig(),
    source: { kind: "manual" },
    tags: [],
  });
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

describe("evaluatorLabels", () => {
  it("upsert inserts a new label with split", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const evalId = await seedEvaluator(t, agentId);
    const convId = await seedConv(t, agentId);

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "fail",
      splitAssignment: "train",
      origin: { kind: "calibration_pass" },
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.humanLabel).toBe("fail");
    expect(row?.splitAssignment).toBe("train");
    expect(row?.origin).toEqual({ kind: "calibration_pass" });
    expect(row?.ratedBy).toBe(userId);
  });

  it("upsert updates an existing label for the same (evaluator, source)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const evalId = await seedEvaluator(t, agentId);
    const convId = await seedConv(t, agentId);

    const a = await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "pass",
      origin: { kind: "calibration_pass" },
    });
    const b = await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "fail",
      splitAssignment: "dev",
      origin: { kind: "calibration_pass" },
    });
    expect(a).toBe(b);
    const row = await t.run(async (ctx) => ctx.db.get(a));
    expect(row?.humanLabel).toBe("fail");
    expect(row?.splitAssignment).toBe("dev");
  });

  it("byEvaluator filters by evaluatorId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const e1 = await seedEvaluator(t, agentId);
    const e2 = await seedEvaluator(t, agentId);
    const c1 = await seedConv(t, agentId);
    const c2 = await seedConv(t, agentId);
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: e1,
      source: { kind: "conversation", conversationId: c1 },
      humanLabel: "pass",
      origin: { kind: "calibration_pass" },
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: e1,
      source: { kind: "conversation", conversationId: c2 },
      humanLabel: "fail",
      origin: { kind: "calibration_pass" },
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: e2,
      source: { kind: "conversation", conversationId: c1 },
      humanLabel: "fail",
      origin: { kind: "calibration_pass" },
    });

    const got = await t.withIdentity(testIdentity).query(api.evaluator.labels.byEvaluator, {
      evaluatorId: e1,
    });
    expect(got).toHaveLength(2);
    for (const l of got) expect(l.evaluatorId).toBe(e1);
  });

  it("counts returns per-split totals", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const evalId = await seedEvaluator(t, agentId);
    const c1 = await seedConv(t, agentId);
    const c2 = await seedConv(t, agentId);
    const c3 = await seedConv(t, agentId);

    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: c1 },
      humanLabel: "pass",
      splitAssignment: "train",
      origin: { kind: "calibration_pass" },
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: c2 },
      humanLabel: "fail",
      splitAssignment: "train",
      origin: { kind: "calibration_pass" },
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: c3 },
      humanLabel: "fail",
      splitAssignment: "dev",
      origin: { kind: "calibration_pass" },
    });

    const counts = await t.withIdentity(testIdentity).query(api.evaluator.labels.counts, {
      evaluatorId: evalId,
    });
    expect(counts.total).toBe(3);
    expect(counts.pass).toBe(1);
    expect(counts.fail).toBe(2);
    expect(counts.train).toBe(2);
    expect(counts.dev).toBe(1);
    expect(counts.test).toBe(0);
  });

  it("remove deletes the label (rater only)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const evalId = await seedEvaluator(t, agentId);
    const convId = await seedConv(t, agentId);
    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "pass",
      origin: { kind: "calibration_pass" },
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.remove, { id });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toBeNull();
  });

  it("rejects unauthenticated", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const evalId = await seedEvaluator(t, agentId);
    const convId = await seedConv(t, agentId);
    await expect(
      t.mutation(api.evaluator.labels.upsert, {
        evaluatorId: evalId,
        source: { kind: "conversation", conversationId: convId },
        humanLabel: "pass",
        origin: { kind: "calibration_pass" },
      }),
    ).rejects.toThrow();
  });
});
