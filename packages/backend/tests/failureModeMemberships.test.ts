import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

async function seedAgent(t: ReturnType<typeof setupTest>, _userId: Id<"users">): Promise<Id<"agents">> {
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

async function seedConversation(t: ReturnType<typeof setupTest>, agentId: Id<"agents">) {
  return await t.run(async (ctx) => ctx.db.insert("conversations", {
    orgId: TEST_ORG_ID, agentIds: [agentId], status: "active", source: "playground", createdAt: Date.now(),
  } as any));
}

describe("failureModeMemberships CRUD", () => {
  it("add inserts a new membership for a conversation source", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "",
    });

    const memId = await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });

    const row = await t.run(async (ctx) => ctx.db.get(memId));
    expect(row?.failureModeId).toBe(fmId);
    expect(row?.source).toEqual({ kind: "conversation", conversationId: convId });
    expect(typeof row?.createdAt).toBe("number");
  });

  it("add is idempotent (calling twice returns the same id)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "",
    });

    const id1 = await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });
    const id2 = await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });
    expect(id1).toBe(id2);

    const all = await t.run(async (ctx) =>
      ctx.db.query("failureModeMemberships").withIndex("by_failure_mode", q => q.eq("failureModeId", fmId)).collect()
    );
    expect(all).toHaveLength(1);
  });

  it("remove deletes the membership", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "",
    });

    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.remove, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });

    const all = await t.run(async (ctx) =>
      ctx.db.query("failureModeMemberships").withIndex("by_failure_mode", q => q.eq("failureModeId", fmId)).collect()
    );
    expect(all).toHaveLength(0);
  });

  it("byFailureMode returns memberships for that failure mode only", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const c1 = await seedConversation(t, agentId);
    const c2 = await seedConversation(t, agentId);
    const fm1 = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "fm1", description: "",
    });
    const fm2 = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "fm2", description: "",
    });

    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fm1, source: { kind: "conversation", conversationId: c1 },
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fm1, source: { kind: "conversation", conversationId: c2 },
    });
    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fm2, source: { kind: "conversation", conversationId: c1 },
    });

    const got = await t.withIdentity(testIdentity).query(api.failureModes.memberships.byFailureMode, { failureModeId: fm1 });
    expect(got).toHaveLength(2);
    for (const m of got) expect(m.failureModeId).toBe(fm1);
  });

  it("transcript source works", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const transcriptId = await t.run(async (ctx) => {
      const csvStorageId = await ctx.storage.store(new Blob(["a,b\n1,2\n"]));
      const uploadId = await ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "ready",
        createdAt: Date.now(),
      } as any);
      return ctx.db.insert("livechatConversations", {
        orgId: TEST_ORG_ID,
        uploadId,
        conversationId: "conv-1",
        visitorId: "vis-1",
        visitorName: "Visitor",
        visitorPhone: "",
        visitorEmail: "",
        agentId: "agent-1",
        agentName: "Agent",
        agentEmail: "",
        inbox: "default",
        labels: [],
        status: "resolved",
        messages: [],
        metadata: {},
        classificationStatus: "none",
        translationStatus: "none",
      } as any);
    });
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "",
    });

    const memId = await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "transcript", transcriptId },
    });
    const row = await t.run(async (ctx) => ctx.db.get(memId));
    expect(row?.source).toEqual({ kind: "transcript", transcriptId });
  });

  it("rejects add for failure mode not in user's org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);

    const foreignFm = await t.run(async (ctx) => ctx.db.insert("failureModes", {
      orgId: "org_other", agentId, name: "f", description: "", order: 0, createdAt: Date.now(),
    }));

    await expect(
      t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
        failureModeId: foreignFm, source: { kind: "conversation", conversationId: convId },
      })
    ).rejects.toThrow(/not found/i);
  });

  it("rejects unauthenticated access", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "",
    });

    await expect(
      t.mutation(api.failureModes.memberships.add, {
        failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
      })
    ).rejects.toThrow();
  });
});
