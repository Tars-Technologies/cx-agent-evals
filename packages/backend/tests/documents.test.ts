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
