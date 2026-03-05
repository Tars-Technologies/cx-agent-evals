import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, seedKB, TEST_ORG_ID } from "./helpers";
import { internal } from "../convex/_generated/api";

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
