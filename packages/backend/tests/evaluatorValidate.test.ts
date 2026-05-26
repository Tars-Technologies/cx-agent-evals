import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
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

async function seedConvWithAssistantMessage(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  assistantText: string,
): Promise<Id<"conversations">> {
  const convId = await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source: "playground" as const,
      createdAt: Date.now(),
    }),
  );
  await t.run(async (ctx) =>
    ctx.db.insert("messages", {
      conversationId: convId,
      order: 0,
      role: "assistant" as const,
      content: assistantText,
      status: "complete" as const,
      createdAt: Date.now(),
    }),
  );
  return convId;
}

describe("evaluator.validate", () => {
  it("computes TPR/TNR and flips status to ready when thresholds met (code evaluator)", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);

    const evalId = await t
      .withIdentity(testIdentity)
      .mutation(api.evaluator.crud.create, {
        agentId,
        name: "must say hello",
        description: "",
        type: "code",
        codeJudgeConfig: {
          checkType: "string_contains",
          params: { needle: "hello", expectPresent: true },
        },
        source: { kind: "manual" },
        tags: [],
      });

    for (let i = 0; i < 10; i++) {
      const containsHello = i < 5;
      const convId = await seedConvWithAssistantMessage(
        t,
        agentId,
        containsHello ? "hello world" : "goodbye world",
      );
      await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
        evaluatorId: evalId,
        source: { kind: "conversation", conversationId: convId },
        humanLabel: containsHello ? "pass" : "fail",
        splitAssignment: "dev",
        origin: { kind: "calibration_pass" },
      });
    }

    const result = await t.action(api.evaluator.validate.run, {
      evaluatorId: evalId,
    });
    expect(result.tpr).toBeCloseTo(1.0, 5);
    expect(result.tnr).toBeCloseTo(1.0, 5);
    expect(result.agreement).toBeCloseTo(1.0, 5);

    const row = await t.run(async (ctx) => ctx.db.get(evalId));
    expect(row?.status).toBe("ready");
    expect(row?.devMetrics).toEqual({ tpr: 1.0, tnr: 1.0, agreement: 1.0 });
  });

  it("stays validated (not ready) when TPR below threshold", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);

    const evalId = await t
      .withIdentity(testIdentity)
      .mutation(api.evaluator.crud.create, {
        agentId,
        name: "must say hi",
        description: "",
        type: "code",
        codeJudgeConfig: {
          checkType: "string_contains",
          params: { needle: "hi", expectPresent: true },
        },
        source: { kind: "manual" },
        tags: [],
      });

    for (let i = 0; i < 5; i++) {
      const convId = await seedConvWithAssistantMessage(t, agentId, "no greeting");
      await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
        evaluatorId: evalId,
        source: { kind: "conversation", conversationId: convId },
        humanLabel: "pass",
        splitAssignment: "dev",
        origin: { kind: "calibration_pass" },
      });
    }

    const result = await t.action(api.evaluator.validate.run, {
      evaluatorId: evalId,
    });
    expect(result.tpr).toBe(0);

    const row = await t.run(async (ctx) => ctx.db.get(evalId));
    expect(row?.status).toBe("validated");
  });

  it("throws when no dev labels exist", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const evalId = await t
      .withIdentity(testIdentity)
      .mutation(api.evaluator.crud.create, {
        agentId,
        name: "x",
        description: "",
        type: "code",
        codeJudgeConfig: {
          checkType: "string_contains",
          params: { needle: "x" },
        },
        source: { kind: "manual" },
        tags: [],
      });

    await expect(
      t.action(api.evaluator.validate.run, { evaluatorId: evalId }),
    ).rejects.toThrow(/dev labels|calibrate/i);
  });

  it("only scores conversation-sourced labels (skips transcript labels until message fetcher is generalized)", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const evalId = await t
      .withIdentity(testIdentity)
      .mutation(api.evaluator.crud.create, {
        agentId,
        name: "x",
        description: "",
        type: "code",
        codeJudgeConfig: {
          checkType: "string_contains",
          params: { needle: "x" },
        },
        source: { kind: "manual" },
        tags: [],
      });
    const convId = await seedConvWithAssistantMessage(t, agentId, "x");
    await t.withIdentity(testIdentity).mutation(api.evaluator.labels.upsert, {
      evaluatorId: evalId,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "pass",
      splitAssignment: "dev",
      origin: { kind: "calibration_pass" },
    });

    await expect(
      t.action(api.evaluator.validate.run, { evaluatorId: evalId }),
    ).resolves.toBeDefined();
  });
});
