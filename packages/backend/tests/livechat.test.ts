import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";

// ─── Helpers ───

function stubConversation(
  uploadId: Id<"livechatUploads">,
  orgId: string,
  idx = 0,
) {
  return {
    uploadId,
    orgId,
    conversationId: `conv-${idx}`,
    visitorId: `visitor-${idx}`,
    visitorName: `Visitor ${idx}`,
    visitorPhone: "",
    visitorEmail: "",
    agentId: `agent-${idx}`,
    agentName: `Agent ${idx}`,
    agentEmail: "",
    inbox: "default",
    labels: [] as string[],
    status: "closed",
    messages: [{ id: 1, role: "user" as const, text: "Hello" }],
    metadata: {},
    classificationStatus: "none" as const,
    translationStatus: "none" as const,
  };
}

async function seedUpload(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  csvStorageId: Id<"_storage">,
  orgId = TEST_ORG_ID,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("livechatUploads", {
      orgId,
      createdBy: userId,
      filename: "test.csv",
      csvStorageId,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

// ─── Tests ───

describe("livechat orchestration", () => {
  it("generateUploadUrl requires auth", async () => {
    const t = setupTest();
    await expect(
      t.mutation(api.livechat.orchestration.generateUploadUrl, {}),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("create inserts upload with pending status", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a,b\n1,2\n"])),
    );

    const { uploadId } = await asUser.mutation(
      api.livechat.orchestration.create,
      { filename: "test.csv", csvStorageId },
    );

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row).not.toBeNull();
    expect(row?.orgId).toBe(TEST_ORG_ID);
    expect(row?.status).toBe("pending");
    expect(row?.filename).toBe("test.csv");
    // No microtopicsStatus field in new schema
    expect(row).not.toHaveProperty("microtopicsStatus");
  });

  it("list returns only org rows", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const ourStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );
    const otherStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "ours.csv",
        csvStorageId: ourStorageId,
        status: "ready",
        createdAt: Date.now(),
      });
      await ctx.db.insert("livechatUploads", {
        orgId: "org_other",
        createdBy: userId,
        filename: "theirs.csv",
        csvStorageId: otherStorageId,
        status: "ready",
        createdAt: Date.now(),
      });
    });

    const rows = await asUser.query(api.livechat.orchestration.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("ours.csv");
  });

  it("get returns null for cross-org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );

    const otherUploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: "org_other",
        createdBy: userId,
        filename: "other.csv",
        csvStorageId: storageId,
        status: "ready",
        createdAt: Date.now(),
      }),
    );

    const result = await asUser.query(api.livechat.orchestration.get, {
      id: otherUploadId,
    });
    expect(result).toBeNull();
  });

  it("insertConversationBatch inserts rows with default statuses", async () => {
    const t = setupTest();
    const userId = await seedUser(t);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    const convs = [
      stubConversation(uploadId, TEST_ORG_ID, 0),
      stubConversation(uploadId, TEST_ORG_ID, 1),
    ];

    await t.mutation(internal.livechat.orchestration.insertConversationBatch, {
      uploadId,
      orgId: TEST_ORG_ID,
      conversations: convs,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("livechatConversations")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .collect(),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].classificationStatus).toBe("none");
    expect(rows[0].translationStatus).toBe("none");
    expect(rows[1].conversationId).toBe("conv-1");
  });

  it("listConversations paginates correctly", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    // Insert 5 conversations
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert(
          "livechatConversations",
          stubConversation(uploadId, TEST_ORG_ID, i),
        );
      }
    });

    const page = await asUser.query(
      api.livechat.orchestration.listConversations,
      {
        uploadId,
        paginationOpts: { numItems: 3, cursor: null },
      },
    );

    expect(page.page).toHaveLength(3);
    expect(page.isDone).toBe(false);
  });

  it("getClassificationCounts returns correct counts", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    await t.run(async (ctx) => {
      // 2 done, 1 running, 1 failed, 1 none
      await ctx.db.insert("livechatConversations", {
        ...stubConversation(uploadId, TEST_ORG_ID, 0),
        classificationStatus: "done",
      });
      await ctx.db.insert("livechatConversations", {
        ...stubConversation(uploadId, TEST_ORG_ID, 1),
        classificationStatus: "done",
      });
      await ctx.db.insert("livechatConversations", {
        ...stubConversation(uploadId, TEST_ORG_ID, 2),
        classificationStatus: "running",
      });
      await ctx.db.insert("livechatConversations", {
        ...stubConversation(uploadId, TEST_ORG_ID, 3),
        classificationStatus: "failed",
      });
      await ctx.db.insert("livechatConversations", {
        ...stubConversation(uploadId, TEST_ORG_ID, 4),
        classificationStatus: "none",
      });
    });

    const counts = await asUser.query(
      api.livechat.orchestration.getClassificationCounts,
      { uploadId },
    );

    expect(counts.total).toBe(5);
    expect(counts.classified).toBe(2);
    expect(counts.running).toBe(1);
    expect(counts.failed).toBe(1);
  });

  it("classifyBatch throws on >100 conversations", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    // Insert 101 conversations via insertConversationBatch in chunks
    const convs = Array.from({ length: 101 }, (_, i) =>
      stubConversation(uploadId, TEST_ORG_ID, i),
    );
    // insertConversationBatch is internal; insert directly
    await t.run(async (ctx) => {
      for (const conv of convs) {
        await ctx.db.insert("livechatConversations", conv);
      }
    });

    const allIds = await t.run(async (ctx) =>
      ctx.db
        .query("livechatConversations")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    );

    expect(allIds).toHaveLength(101);

    await expect(
      asUser.mutation(api.livechat.orchestration.classifyBatch, {
        uploadId,
        conversationIds: allIds,
      }),
    ).rejects.toThrow(/100/);
  });

  it("translateBatch throws on >100 conversations", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert(
          "livechatConversations",
          stubConversation(uploadId, TEST_ORG_ID, i),
        );
      }
    });

    const allIds = await t.run(async (ctx) =>
      ctx.db
        .query("livechatConversations")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .collect()
        .then((rows) => rows.map((r) => r._id)),
    );

    await expect(
      asUser.mutation(api.livechat.orchestration.translateBatch, {
        uploadId,
        conversationIds: allIds,
      }),
    ).rejects.toThrow(/100/);
  });

  it("remove marks as deleting", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv data"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    await asUser.mutation(api.livechat.orchestration.remove, { id: uploadId });

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    // Row should be marked as deleting (async deletion scheduled)
    expect(row?.status).toBe("deleting");
  });

  it("patchClassificationStatus updates fields correctly", async () => {
    const t = setupTest();
    const userId = await seedUser(t);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    const convId = await t.run(async (ctx) =>
      ctx.db.insert(
        "livechatConversations",
        stubConversation(uploadId, TEST_ORG_ID, 0),
      ),
    );

    await t.mutation(internal.livechat.orchestration.patchClassificationStatus, {
      conversationId: convId,
      status: "done",
      messageTypes: [{ type: "inquiry", count: 2 }],
    });

    const row = await t.run(async (ctx) => ctx.db.get(convId));
    expect(row?.classificationStatus).toBe("done");
    expect(row?.messageTypes).toEqual([{ type: "inquiry", count: 2 }]);
    expect(row?.classificationError).toBeUndefined();
  });

  it("patchTranslationStatus updates fields correctly", async () => {
    const t = setupTest();
    const userId = await seedUser(t);

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const uploadId = await seedUpload(t, userId, csvStorageId);

    const convId = await t.run(async (ctx) =>
      ctx.db.insert(
        "livechatConversations",
        stubConversation(uploadId, TEST_ORG_ID, 0),
      ),
    );

    await t.mutation(internal.livechat.orchestration.patchTranslationStatus, {
      conversationId: convId,
      status: "done",
      translatedMessages: [{ id: 1, text: "Hola" }],
    });

    const row = await t.run(async (ctx) => ctx.db.get(convId));
    expect(row?.translationStatus).toBe("done");
    expect(row?.translatedMessages).toEqual([{ id: 1, text: "Hola" }]);
    expect(row?.translationError).toBeUndefined();
  });
});
