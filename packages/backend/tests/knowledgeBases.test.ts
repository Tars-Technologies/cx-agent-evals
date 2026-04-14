import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, seedDocument, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

describe("knowledgeBases: create with metadata", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => {
    t = setupTest();
  });

  it("creates a KB with industry and company metadata", async () => {
    await seedUser(t);
    const authedT = t.withIdentity(testIdentity);
    const kbId = await authedT.mutation(api.crud.knowledgeBases.create, {
      name: "JPMorgan Chase Support",
      description: "Customer support KB",
      industry: "finance",
      subIndustry: "retail-banking",
      company: "JPMorgan Chase",
      entityType: "company",
      sourceUrl: "https://www.chase.com/support",
      tags: ["fortune-500", "cx", "support"],
    });
    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.industry).toBe("finance");
    expect(kb!.company).toBe("JPMorgan Chase");
    expect(kb!.tags).toEqual(["fortune-500", "cx", "support"]);
  });

  it("creates a KB without metadata (backward compatible)", async () => {
    await seedUser(t);
    const authedT = t.withIdentity(testIdentity);
    const kbId = await authedT.mutation(api.crud.knowledgeBases.create, {
      name: "Basic KB",
    });
    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.name).toBe("Basic KB");
    expect(kb!.industry).toBeUndefined();
  });
});

describe("knowledgeBases: listByIndustry", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => {
    t = setupTest();
  });

  it("returns all KBs when no industry filter", async () => {
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Finance KB",
        metadata: {},
        industry: "finance",
        createdBy: userId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Healthcare KB",
        metadata: {},
        industry: "healthcare",
        createdBy: userId,
        createdAt: Date.now(),
      });
    });
    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(
      api.crud.knowledgeBases.listByIndustry,
      {},
    );
    expect(results).toHaveLength(2);
  });

  it("filters by industry when provided", async () => {
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Finance KB",
        metadata: {},
        industry: "finance",
        createdBy: userId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Healthcare KB",
        metadata: {},
        industry: "healthcare",
        createdBy: userId,
        createdAt: Date.now(),
      });
    });
    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(
      api.crud.knowledgeBases.listByIndustry,
      {
        industry: "finance",
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Finance KB");
  });
});

describe("knowledgeBases: listWithDocCounts", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("returns KBs with correct document counts", async () => {
    const userId = await seedUser(t);
    const kb1 = await seedKB(t, userId);
    const kb2Id = await t.run(async (ctx) =>
      ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Empty KB",
        metadata: {},
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );

    await seedDocument(t, kb1, { title: "Doc 1" });
    await seedDocument(t, kb1, { title: "Doc 2" });
    await seedDocument(t, kb1, { title: "Doc 3" });

    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(api.crud.knowledgeBases.listWithDocCounts, {});

    expect(results).toHaveLength(2);
    const kbWithDocs = results.find((kb) => kb.name === "Test KB");
    const emptyKb = results.find((kb) => kb.name === "Empty KB");
    expect(kbWithDocs!.documentCount).toBe(3);
    expect(emptyKb!.documentCount).toBe(0);
  });

  it("filters by industry when provided", async () => {
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Finance KB", metadata: {},
        industry: "finance", createdBy: userId, createdAt: Date.now(),
      });
      await ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID, name: "Healthcare KB", metadata: {},
        industry: "healthcare", createdBy: userId, createdAt: Date.now(),
      });
    });

    const authedT = t.withIdentity(testIdentity);
    const results = await authedT.query(
      api.crud.knowledgeBases.listWithDocCounts,
      { industry: "finance" },
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Finance KB");
    expect(results[0].documentCount).toBe(0);
  });
});

describe("documentCount: increment/decrement", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("increments documentCount when a document is created", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);

    // KB starts with no documentCount
    let kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBeUndefined();

    // Seed a document (seedDocument now increments the count)
    await seedDocument(t, kbId, { title: "Doc 1" });
    kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(1);

    await seedDocument(t, kbId, { title: "Doc 2" });
    kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(2);
  });

  it("decrements documentCount when a document is removed", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);

    const docId = await seedDocument(t, kbId, { title: "Doc 1" });
    await seedDocument(t, kbId, { title: "Doc 2" });

    let kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(2);

    const authedT = t.withIdentity(testIdentity);
    await authedT.mutation(api.crud.documents.remove, { id: docId as Id<"documents"> });

    kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(1);
  });

  it("does not go below zero on decrement", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);

    // Manually insert a doc without incrementing count (simulates pre-backfill state)
    const docId = await t.run(async (ctx) =>
      ctx.db.insert("documents", {
        orgId: TEST_ORG_ID,
        kbId,
        docId: "orphan",
        title: "orphan",
        content: "test",
        contentLength: 4,
        metadata: {},
        createdAt: Date.now(),
      }),
    );

    const authedT = t.withIdentity(testIdentity);
    await authedT.mutation(api.crud.documents.remove, { id: docId });

    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(0);
  });
});
