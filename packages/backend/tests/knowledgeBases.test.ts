import { expect, describe, it, beforeEach } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

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
