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
