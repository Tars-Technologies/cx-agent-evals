import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api, internal } from "../convex/_generated/api";
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

const llmJudgeConfig = (name = "tone", rubric = "polite") => ({
  dimensions: [{ name, rubric, passExamples: [], failExamples: [] }],
  outputFormat: "per_dimension" as const,
  model: "gpt-4o-mini",
  inputContext: ["transcript" as const],
});

describe("evaluators CRUD (rev 3 shape)", () => {
  it("create manual llm_judge: status=draft, source.kind=manual", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "tone", description: "tone judge",
      type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(),
      source: { kind: "manual" },
      tags: [],
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe("draft");
    expect(row?.source).toEqual({ kind: "manual" });
    expect(row?.llmJudgeConfig?.dimensions).toHaveLength(1);
    expect(row?.codeJudgeConfig).toBeUndefined();
  });

  it("create manual code evaluator: codeJudgeConfig set, llmJudgeConfig absent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "escalate", description: "must call escalate_to_human",
      type: "code",
      codeJudgeConfig: { checkType: "tool_call_match", params: { toolName: "escalate_to_human" } },
      source: { kind: "manual" },
      tags: ["escalation"],
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.type).toBe("code");
    expect(row?.codeJudgeConfig?.checkType).toBe("tool_call_match");
    expect(row?.llmJudgeConfig).toBeUndefined();
  });

  it("createFromTemplate inherits prefilledConfig and source.kind = template", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const templates = await t.withIdentity(testIdentity).query(api.evaluator.templates.byCategory, { category: "safety" });
    expect(templates.length).toBeGreaterThan(0);
    const tpl = templates[0];

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.createFromTemplate, {
      agentId, templateId: tpl._id,
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "template", templateId: tpl._id });
    expect(row?.type).toBe(tpl.type);
    expect(row?.name).toBe(tpl.name);
    expect(row?.status).toBe("draft");
    if (tpl.type === "llm_judge") {
      expect(row?.llmJudgeConfig).toBeDefined();
      expect(row?.codeJudgeConfig).toBeUndefined();
    } else {
      expect(row?.codeJudgeConfig).toBeDefined();
      expect(row?.llmJudgeConfig).toBeUndefined();
    }
  });

  it("byAgent returns only this agent's evaluators", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const a1 = await seedAgent(t, userId);
    const a2 = await seedAgent(t, userId);

    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId: a1, name: "x", description: "", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId: a2, name: "y", description: "", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
    });

    const got = await t.withIdentity(testIdentity).query(api.evaluator.crud.byAgent, { agentId: a1 });
    expect(got).toHaveLength(1);
    expect(got[0].agentId).toBe(a1);
  });

  it("byAgentStatus filters by status", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "x", description: "", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.updateStatus, { id, status: "ready" });

    const draft = await t.withIdentity(testIdentity).query(api.evaluator.crud.byAgentStatus, { agentId, status: "draft" });
    expect(draft).toHaveLength(0);
    const ready = await t.withIdentity(testIdentity).query(api.evaluator.crud.byAgentStatus, { agentId, status: "ready" });
    expect(ready).toHaveLength(1);
  });

  it("updateStatus walks the lifecycle", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "x", description: "", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
    });
    for (const status of ["calibrating", "validated", "ready"] as const) {
      await t.withIdentity(testIdentity).mutation(api.evaluator.crud.updateStatus, { id, status });
      const row = await t.run(async (ctx) => ctx.db.get(id));
      expect(row?.status).toBe(status);
    }
  });

  it("update patches name/description/dimensions/tags but not status/source", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "x", description: "old", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: ["a"],
    });
    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.update, {
      id, name: "renamed", description: "new", tags: ["b", "c"],
      llmJudgeConfig: llmJudgeConfig("new-name", "new rubric"),
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.name).toBe("renamed");
    expect(row?.description).toBe("new");
    expect(row?.tags).toEqual(["b", "c"]);
    expect(row?.llmJudgeConfig?.dimensions[0].rubric).toBe("new rubric");
    expect(row?.source).toEqual({ kind: "manual" });
    expect(row?.status).toBe("draft");
  });

  it("remove deletes evaluator AND cascades evaluatorLabels", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "x", description: "", type: "llm_judge",
      llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
    });

    const convId = await t.run(async (ctx) => ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID, agentIds: [agentId], status: "active", source: "playground", createdAt: Date.now(),
    } as any));
    await t.run(async (ctx) => ctx.db.insert("evaluatorLabels", {
      orgId: TEST_ORG_ID, evaluatorId: id,
      source: { kind: "conversation", conversationId: convId },
      humanLabel: "pass",
      origin: { kind: "calibration_pass" },
      ratedBy: userId,
      createdAt: Date.now(),
    }));

    await t.withIdentity(testIdentity).mutation(api.evaluator.crud.remove, { id });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toBeNull();
    const labels = await t.run(async (ctx) =>
      ctx.db.query("evaluatorLabels").withIndex("by_evaluator", q => q.eq("evaluatorId", id)).collect()
    );
    expect(labels).toHaveLength(0);
  });

  it("rejects update / remove for evaluator not in user's org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const foreignId = await t.run(async (ctx) => ctx.db.insert("evaluators", {
      orgId: "org_other", agentId, name: "f", description: "",
      type: "llm_judge", llmJudgeConfig: llmJudgeConfig(),
      source: { kind: "manual" }, status: "draft", tags: [], createdAt: Date.now(),
    } as any));
    await expect(
      t.withIdentity(testIdentity).mutation(api.evaluator.crud.remove, { id: foreignId })
    ).rejects.toThrow(/not found/i);
  });

  it("rejects unauthenticated create", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    await expect(
      t.mutation(api.evaluator.crud.create, {
        agentId, name: "x", description: "", type: "llm_judge",
        llmJudgeConfig: llmJudgeConfig(), source: { kind: "manual" }, tags: [],
      })
    ).rejects.toThrow();
  });
});
