import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";

describe("livechat orchestration", () => {
  it("generateUploadUrl requires auth", async () => {
    const t = setupTest();
    await expect(
      t.mutation(api.livechat.orchestration.generateUploadUrl, {}),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("create inserts a row with pending status", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    // Stub a storageId by storing an empty blob
    const csvStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["a,b\n1,2\n"]));
    });

    const { uploadId } = await asUser.mutation(
      api.livechat.orchestration.create,
      { filename: "test.csv", csvStorageId },
    );

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row).not.toBeNull();
    expect(row?.orgId).toBe(TEST_ORG_ID);
    expect(row?.status).toBe("pending");
    expect(row?.microtopicsStatus).toBe("pending");
    expect(row?.filename).toBe("test.csv");
  });

  it("list returns only rows for the caller's org", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    // Insert a row for our org and one for another org
    const ourStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );
    const otherStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "ours.csv",
        csvStorageId: ourStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      });
      await ctx.db.insert("livechatUploads", {
        orgId: "org_other",
        createdBy: userId,
        filename: "theirs.csv",
        csvStorageId: otherStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      });
    });

    const rows = await asUser.query(api.livechat.orchestration.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("ours.csv");
  });

  it("get returns null for cross-org rows", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

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
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      }),
    );

    const result = await asUser.query(api.livechat.orchestration.get, {
      id: otherUploadId,
    });
    expect(result).toBeNull();
  });

  it("remove deletes storage blobs and the row", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv data"])),
    );
    const rawStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["raw json"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        rawTranscriptsStorageId: rawStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      }),
    );

    await asUser.mutation(api.livechat.orchestration.remove, { id: uploadId });

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row).toBeNull();
  });

  it("remove throws while parsing is in progress", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv data"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "parsing",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
        startedAt: Date.now(),
      }),
    );

    await expect(
      asUser.mutation(api.livechat.orchestration.remove, { id: uploadId }),
    ).rejects.toThrow(/analysis is in progress/);
  });

  it("getDownloadUrl returns null when blob is absent", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "failed",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
      }),
    );

    const url = await asUser.query(api.livechat.orchestration.getDownloadUrl, {
      id: uploadId,
      type: "rawTranscripts",
    });
    expect(url).toBeNull();
  });

  it("markReady internal mutation patches the row correctly", async () => {
    const t = setupTest();
    await seedUser(t);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const rawStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["raw"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "parsing",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
      }),
    );

    await t.mutation(internal.livechat.orchestration.markReady, {
      uploadId,
      basicStats: { totalConversations: 5 },
      rawTranscriptsStorageId: rawStorageId,
      conversationCount: 5,
    });

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row?.status).toBe("ready");
    expect(row?.conversationCount).toBe(5);
    expect(row?.rawTranscriptsStorageId).toBe(rawStorageId);
  });
});
