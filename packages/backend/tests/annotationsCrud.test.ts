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

async function seedConversation(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  source: "playground" | "simulation" = "playground",
): Promise<Id<"conversations">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source,
      createdAt: Date.now(),
    }),
  );
}

async function seedUpload(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
) {
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

async function seedTranscript(
  t: ReturnType<typeof setupTest>,
  uploadId: Id<"livechatUploads">,
): Promise<Id<"livechatConversations">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("livechatConversations", {
      uploadId,
      orgId: TEST_ORG_ID,
      conversationId: "conv-1",
      visitorId: "v1",
      visitorName: "Visitor",
      visitorPhone: "",
      visitorEmail: "",
      agentId: "a1",
      agentName: "Agent",
      agentEmail: "",
      inbox: "",
      labels: [],
      status: "closed",
      messages: [],
      metadata: {},
      classificationStatus: "none" as const,
      translationStatus: "none" as const,
    }),
  );
}

describe("annotations CRUD (polymorphic source)", () => {
  it("upsert creates an annotation for a conversation", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);

    const id = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: convId },
      rating: "bad",
      tags: ["tone_issue"],
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "conversation", conversationId: convId });
    expect(row?.rating).toBe("bad");
    expect(row?.tags).toEqual(["tone_issue"]);
    expect(row?.ratedBy).toBe(userId);
  });

  it("upsert updates an existing annotation for the same (user, source)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);

    const id1 = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: convId },
      rating: "bad", tags: ["x"],
    });
    const id2 = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: convId },
      rating: "good_enough", tags: ["y"], comment: "improved",
    });

    expect(id1).toBe(id2);
    const row = await t.run(async (ctx) => ctx.db.get(id1));
    expect(row?.rating).toBe("good_enough");
    expect(row?.tags).toEqual(["y"]);
    expect(row?.comment).toBe("improved");
    expect(typeof row?.updatedAt).toBe("number");
  });

  it("transcript-source annotation", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const uploadId = await seedUpload(t, userId);
    const transcriptId = await seedTranscript(t, uploadId);

    const id = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "transcript", transcriptId },
      rating: "pass", tags: [],
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "transcript", transcriptId });
  });

  it("bySource returns annotations for the given conversation only", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const conv1 = await seedConversation(t, agentId);
    const conv2 = await seedConversation(t, agentId);

    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv1 }, rating: "bad", tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv2 }, rating: "good_enough", tags: [],
    });

    const got = await t.withIdentity(testIdentity).query(api.annotations.crud.bySource, {
      source: { kind: "conversation", conversationId: conv1 },
    });
    expect(got).toHaveLength(1);
    expect(got[0].source).toEqual({ kind: "conversation", conversationId: conv1 });
  });

  it("allTagsForOrg returns deduplicated sorted tags across all sources", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const conv1 = await seedConversation(t, agentId);
    const conv2 = await seedConversation(t, agentId);

    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv1 }, rating: "bad", tags: ["b", "a"],
    });
    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv2 }, rating: "bad", tags: ["a", "c"],
    });

    const tags = await t.withIdentity(testIdentity).query(api.annotations.crud.allTagsForOrg, {});
    expect(tags).toEqual(["a", "b", "c"]);
  });

  it("rejects unauthenticated upsert", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);

    await expect(
      t.mutation(api.annotations.crud.upsert, {
        source: { kind: "conversation", conversationId: convId },
        rating: "bad", tags: [],
      })
    ).rejects.toThrow();
  });

  it("remove deletes the annotation when called by the rater", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const convId = await seedConversation(t, agentId);

    const id = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: convId }, rating: "bad", tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.annotations.crud.remove, { id });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toBeNull();
  });

  it("statsForSources returns rating histogram for the given source set", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const conv1 = await seedConversation(t, agentId);
    const conv2 = await seedConversation(t, agentId);
    const conv3 = await seedConversation(t, agentId);

    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv1 }, rating: "great", tags: [],
    });
    await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: conv2 }, rating: "bad", tags: [],
    });
    // conv3 unannotated

    const stats = await t.withIdentity(testIdentity).query(api.annotations.crud.statsForSources, {
      sources: [
        { kind: "conversation", conversationId: conv1 },
        { kind: "conversation", conversationId: conv2 },
        { kind: "conversation", conversationId: conv3 },
      ],
    });
    expect(stats.total).toBe(3);
    expect(stats.annotated).toBe(2);
    expect(stats.great).toBe(1);
    expect(stats.bad).toBe(1);
  });
});
