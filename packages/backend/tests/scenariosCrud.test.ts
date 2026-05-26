import { describe, it, expect } from "vitest";
import { setupTest, seedUser, seedKB, testIdentity, TEST_ORG_ID } from "./helpers";
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

async function seedUpload(t: ReturnType<typeof setupTest>, userId: Id<"users">) {
  // livechatUploads requires a real csvStorageId — store a small blob to get one
  const csvStorageId = await t.run(async (ctx: any) =>
    ctx.storage.store(new Blob(["a,b\n1,2\n"])),
  );
  return await t.run(async (ctx) =>
    ctx.db.insert("livechatUploads", {
      orgId: TEST_ORG_ID,
      createdBy: userId,
      filename: "test.csv",
      csvStorageId,
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
}

function baseScenarioFields() {
  return {
    persona: {
      type: "customer",
      traits: ["impatient"],
      communicationStyle: "direct",
      patienceLevel: "low" as const,
    },
    topic: "billing",
    intent: "refund",
    complexity: "low" as const,
    reasonForContact: "wrong charge",
    knownInfo: "amount",
    unknownInfo: "policy",
    instruction: "help the user",
  };
}

describe("scenarios CRUD (rev 3 shape)", () => {
  it("create with synthetic source records agentId + kbId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId,
      source: { kind: "synthetic", kbId },
      ...baseScenarioFields(),
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.agentId).toBe(agentId);
    expect(row?.source).toEqual({ kind: "synthetic", kbId });
    expect(typeof row?.createdAt).toBe("number");
  });

  it("create with grounded source records transcriptUploadId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const uploadId = await seedUpload(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId,
      source: { kind: "grounded", transcriptUploadId: uploadId },
      ...baseScenarioFields(),
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "grounded", transcriptUploadId: uploadId });
  });

  it("create with manual source has no kb/transcript reference", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId,
      source: { kind: "manual" },
      ...baseScenarioFields(),
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "manual" });
  });

  it("byAgent returns scenarios only for that agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const agent1 = await seedAgent(t, userId);
    const agent2 = await seedAgent(t, userId);

    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent1, source: { kind: "synthetic", kbId }, ...baseScenarioFields(),
    });
    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent1, source: { kind: "manual" }, ...baseScenarioFields(),
    });
    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent2, source: { kind: "synthetic", kbId }, ...baseScenarioFields(),
    });

    const got = await t.withIdentity(testIdentity).query(api.conversationSim.scenarios.byAgent, { agentId: agent1 });
    expect(got).toHaveLength(2);
    for (const s of got) expect(s.agentId).toBe(agent1);
  });

  it("byKb returns scenarios depending on that KB (impact analysis)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kb1 = await seedKB(t, userId);
    const kb2 = await seedKB(t, userId);
    const agent = await seedAgent(t, userId);

    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent, source: { kind: "synthetic", kbId: kb1 }, ...baseScenarioFields(),
    });
    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent, source: { kind: "synthetic", kbId: kb2 }, ...baseScenarioFields(),
    });

    const got = await t.withIdentity(testIdentity).query(api.conversationSim.scenarios.byKb, { kbId: kb1 });
    expect(got).toHaveLength(1);
    expect(got[0].source).toMatchObject({ kbId: kb1 });
  });

  it("update patches scenario content fields without losing source/agentId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agent = await seedAgent(t, userId);
    const kbId = await seedKB(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent, source: { kind: "synthetic", kbId }, ...baseScenarioFields(),
    });

    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.update, {
      id, topic: "updated topic",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.topic).toBe("updated topic");
    expect(row?.agentId).toBe(agent);
    expect(row?.source).toEqual({ kind: "synthetic", kbId });
  });

  it("remove deletes the scenario", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agent = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.create, {
      agentId: agent, source: { kind: "manual" }, ...baseScenarioFields(),
    });
    await t.withIdentity(testIdentity).mutation(api.conversationSim.scenarios.remove, { id });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toBeNull();
  });

  it("rejects unauthenticated access", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agent = await seedAgent(t, userId);

    await expect(
      t.mutation(api.conversationSim.scenarios.create, {
        agentId: agent, source: { kind: "manual" }, ...baseScenarioFields(),
      }),
    ).rejects.toThrow();
  });
});
