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

describe("failureModes CRUD (agent-scoped)", () => {
  it("create assigns order 0 for first failure mode on an agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);

    const id = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaId, name: "promo confusion", description: "agent confuses promo codes",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.agentId).toBe(agentId);
    expect(row?.name).toBe("promo confusion");
    expect(row?.order).toBe(0);
    expect(typeof row?.createdAt).toBe("number");
  });

  it("create auto-increments order for subsequent failure modes on the same agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);

    const id1 = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaId, name: "a", description: "",
    });
    const id2 = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaId, name: "b", description: "",
    });

    const r1 = await t.run(async (ctx) => ctx.db.get(id1));
    const r2 = await t.run(async (ctx) => ctx.db.get(id2));
    expect(r1?.order).toBe(0);
    expect(r2?.order).toBe(1);
  });

  it("byAgent returns failure modes only for that agent, sorted by order", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agent1 = await seedAgent(t, userId);
    const agent2 = await seedAgent(t, userId);
    const ea1 = await seedAnalysis(t, agent1);
    const ea2 = await seedAnalysis(t, agent2);

    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId: agent1, errorAnalysisId: ea1, name: "a1", description: "",
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId: agent1, errorAnalysisId: ea1, name: "a2", description: "",
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId: agent2, errorAnalysisId: ea2, name: "b1", description: "",
    });

    const got1 = await t.withIdentity(testIdentity).query(api.failureModes.crud.byAgent, { agentId: agent1 });
    expect(got1).toHaveLength(2);
    expect(got1[0].order).toBeLessThan(got1[1].order);
    for (const m of got1) expect(m.agentId).toBe(agent1);
  });

  it("update patches name and description", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);

    const id = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaId, name: "a", description: "old",
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.update, {
      id, name: "a-renamed", description: "new",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.name).toBe("a-renamed");
    expect(row?.description).toBe("new");
    expect(typeof row?.updatedAt).toBe("number");
  });

  it("remove deletes the failure mode AND its memberships (cascade)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);
    const id = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaId, name: "x", description: "",
    });

    // Insert a membership directly (the memberships CRUD is Task 7; here we just seed the row)
    const convId = await t.run(async (ctx) => ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID, agentIds: [agentId], status: "active", source: "playground", createdAt: Date.now(),
    } as any));
    await t.run(async (ctx) => ctx.db.insert("failureModeMemberships", {
      orgId: TEST_ORG_ID,
      failureModeId: id,
      source: { kind: "conversation", conversationId: convId },
      createdAt: Date.now(),
    }));

    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.remove, { id });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toBeNull();
    const remainingMemberships = await t.run(async (ctx) =>
      ctx.db.query("failureModeMemberships").withIndex("by_failure_mode", q => q.eq("failureModeId", id)).collect()
    );
    expect(remainingMemberships).toHaveLength(0);
  });

  it("rejects create / update / remove without auth", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaId = await seedAnalysis(t, agentId);

    await expect(
      t.mutation(api.failureModes.crud.create, { agentId, errorAnalysisId: eaId, name: "x", description: "" })
    ).rejects.toThrow();
  });

  it("rejects update / remove for failure mode not in user's org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    // Insert a row with a different orgId directly
    const foreignEa = await seedAnalysis(t, agentId, "org_other");
    const foreignId = await t.run(async (ctx) => ctx.db.insert("failureModes", {
      orgId: "org_other",
      agentId,
      errorAnalysisId: foreignEa,
      name: "foreign", description: "", order: 0,
      createdAt: Date.now(),
    }));

    await expect(
      t.withIdentity(testIdentity).mutation(api.failureModes.crud.remove, { id: foreignId })
    ).rejects.toThrow(/not found/i);
  });

  it("byAnalysis returns failure modes scoped to the given errorAnalysisId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const eaA = await seedAnalysis(t, agentId);
    const eaB = await seedAnalysis(t, agentId);

    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaA, name: "a1", description: "",
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaA, name: "a2", description: "",
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, errorAnalysisId: eaB, name: "b1", description: "",
    });

    const gotA = await t.withIdentity(testIdentity).query(api.failureModes.crud.byAnalysis, { errorAnalysisId: eaA });
    const gotB = await t.withIdentity(testIdentity).query(api.failureModes.crud.byAnalysis, { errorAnalysisId: eaB });
    expect(gotA).toHaveLength(2);
    expect(gotB).toHaveLength(1);
    for (const m of gotA) expect(m.errorAnalysisId).toBe(eaA);
    for (const m of gotB) expect(m.errorAnalysisId).toBe(eaB);
  });
});
