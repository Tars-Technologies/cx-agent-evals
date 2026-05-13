import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, seedDocument, TEST_ORG_ID, testIdentity } from "./helpers";
import { internal, api } from "../convex/_generated/api";

describe("documents: createFromScrape", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("creates a document from scraped content without fileId", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "Chase Support FAQ",
      content: "# FAQ\n\nHow do I reset my password?",
      sourceUrl: "https://www.chase.com/support/faq",
      sourceType: "scraped",
    });
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc!.title).toBe("Chase Support FAQ");
    expect(doc!.sourceUrl).toBe("https://www.chase.com/support/faq");
    expect(doc!.sourceType).toBe("scraped");
    expect(doc!.fileId).toBeUndefined();
    expect(doc!.contentLength).toBe(34);
  });
});

describe("documents: ASCII-safe docId", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("produces an ASCII hex docId even when title contains em-dash", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const id = await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "BRIGHT MINDS—Proven Ways to Reduce the Risk | Amen Clinics",
      content: "body",
      sourceUrl: "https://www.amenclinics.com/blog/bright-minds",
      sourceType: "scraped",
    });
    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc!.docId).toMatch(/^[0-9a-f]{16}$/);
    expect(doc!.title).toContain("—");
  });

  it("derives the same docId from the same sourceUrl deterministically", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const url = "https://example.com/page";
    const id1 = await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID, kbId, title: "A", content: "x", sourceUrl: url,
    });
    const id2 = await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID, kbId, title: "B (renamed)", content: "y", sourceUrl: url,
    });
    const [d1, d2] = await t.run(async (ctx) => [
      await ctx.db.get(id1),
      await ctx.db.get(id2),
    ]);
    expect(d1!.docId).toBe(d2!.docId);
  });

  it("throws when scraped insert is missing sourceUrl", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    await expect(
      t.mutation(internal.crud.documents.createFromScrape, {
        orgId: TEST_ORG_ID, kbId, title: "no url", content: "x",
      }),
    ).rejects.toThrow(/sourceUrl or fileId/);
  });
});

describe("documents: remove", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("deletes a document owned by the same org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId, { title: "To Delete" });

    const authedT = t.withIdentity(testIdentity);
    await authedT.mutation(api.crud.documents.remove, { id: docId });

    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc).toBeNull();
  });

  it("throws when deleting a document from another org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    const otherOrgIdentity = {
      ...testIdentity,
      org_id: "org_other999",
    };
    const otherT = t.withIdentity(otherOrgIdentity);

    await expect(
      otherT.mutation(api.crud.documents.remove, { id: docId }),
    ).rejects.toThrow("Document not found");
  });
});

describe("documents: documentCount maintenance", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("increments documentCount on create", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const authedT = t.withIdentity(testIdentity);

    const storageId1 = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["one"])),
    );
    await authedT.mutation(api.crud.documents.create, {
      kbId,
      storageId: storageId1,
      title: "Doc 1",
      content: "one",
    });

    let kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(1);

    const storageId2 = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["two"])),
    );
    await authedT.mutation(api.crud.documents.create, {
      kbId,
      storageId: storageId2,
      title: "Doc 2",
      content: "two",
    });

    kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(2);
  });

  it("increments documentCount on createFromScrape", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);

    await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "Scraped 1",
      content: "x",
      sourceUrl: "https://example.com/1",
    });
    await t.mutation(internal.crud.documents.createFromScrape, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "Scraped 2",
      content: "y",
      sourceUrl: "https://example.com/2",
    });

    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(2);
  });

  it("decrements documentCount on remove", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const authedT = t.withIdentity(testIdentity);

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a"])),
    );
    const docId = await authedT.mutation(api.crud.documents.create, {
      kbId,
      storageId,
      title: "Doc",
      content: "a",
    });
    await authedT.mutation(api.crud.documents.remove, { id: docId });

    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(0);
  });

  it("clamps to 0 when removing from a kb whose count is already 0", async () => {
    // Drift scenario: doc was seeded directly (e.g. pre-backfill) so KB has
    // no documentCount yet. The Math.max floor protects against going negative.
    // The handler also logs a drift warning — visible in test stderr but not
    // intercepted by vi.spyOn since Convex runs handlers in a separate realm.
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId, { title: "Orphan" });
    const authedT = t.withIdentity(testIdentity);

    await authedT.mutation(api.crud.documents.remove, { id: docId });

    const kb = await t.run(async (ctx) => ctx.db.get(kbId));
    expect(kb!.documentCount).toBe(0);
  });
});

describe("documents: listCustomizedDocs", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("excludes docs with undefined priority via by_kb_priority index", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const authedT = t.withIdentity(testIdentity);

    // 3 docs: one priority=1, one priority=5, one with no priority set.
    await t.run(async (ctx) => {
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "low", title: "Low",
        content: "x", contentLength: 1, metadata: {},
        priority: 1, createdAt: Date.now(),
      });
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "high", title: "High",
        content: "x", contentLength: 1, metadata: {},
        priority: 5, createdAt: Date.now(),
      });
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "none", title: "None",
        content: "x", contentLength: 1, metadata: {},
        createdAt: Date.now(),
      });
    });

    const docs = await authedT.query(api.crud.documents.listCustomizedDocs, {
      kbId,
    });

    const titles = docs.map((d) => d.title).sort();
    expect(titles).toEqual(["High", "Low"]);
    expect(docs.every((d) => d.priority !== undefined)).toBe(true);
  });

  it("returns customized docs ordered by priority desc", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const authedT = t.withIdentity(testIdentity);

    await t.run(async (ctx) => {
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "p2", title: "P2",
        content: "x", contentLength: 1, metadata: {},
        priority: 2, createdAt: Date.now(),
      });
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "p5", title: "P5",
        content: "x", contentLength: 1, metadata: {},
        priority: 5, createdAt: Date.now(),
      });
      await ctx.db.insert("documents", {
        orgId: TEST_ORG_ID, kbId, docId: "p3", title: "P3",
        content: "x", contentLength: 1, metadata: {},
        priority: 3, createdAt: Date.now(),
      });
    });

    const docs = await authedT.query(api.crud.documents.listCustomizedDocs, {
      kbId,
    });
    expect(docs.map((d) => d.priority)).toEqual([5, 3, 2]);
  });
});

describe("knowledgeBases: backfillDocumentCounts", () => {
  let t: ReturnType<typeof import("convex-test").convexTest>;
  beforeEach(() => { t = setupTest(); });

  it("skips KBs that already have documentCount set", async () => {
    const userId = await seedUser(t);

    // KB A: already has documentCount, but the actual doc count differs
    // (simulating a value seeded by `create` before backfill ran).
    const kbAId = await t.run(async (ctx) =>
      ctx.db.insert("knowledgeBases", {
        orgId: TEST_ORG_ID,
        name: "Already counted KB",
        metadata: {},
        documentCount: 7, // intentionally not matching real doc count
        createdBy: userId,
        createdAt: Date.now(),
      }),
    );
    // Seed 2 docs directly (real count is 2, but stored count is 7).
    await seedDocument(t, kbAId, { title: "A1" });
    await seedDocument(t, kbAId, { title: "A2" });

    // KB B: documentCount missing, with 3 real docs. Backfill should set to 3.
    const kbBId = await seedKB(t, userId);
    await seedDocument(t, kbBId, { title: "B1" });
    await seedDocument(t, kbBId, { title: "B2" });
    await seedDocument(t, kbBId, { title: "B3" });

    const result = await t.action(
      internal.crud.knowledgeBasesActions.backfillDocumentCounts,
      {},
    );

    expect(result.kbs).toBe(1); // Only KB B was missing count
    expect(result.updated).toBe(1);

    const kbA = await t.run(async (ctx) => ctx.db.get(kbAId));
    const kbB = await t.run(async (ctx) => ctx.db.get(kbBId));
    expect(kbA!.documentCount).toBe(7); // unchanged — skipped
    expect(kbB!.documentCount).toBe(3); // backfilled to real count
  });
});
