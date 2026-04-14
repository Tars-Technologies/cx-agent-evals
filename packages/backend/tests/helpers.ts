import { convexTest } from "convex-test";
import schema from "../convex/schema";
import workpoolTest from "@convex-dev/workpool/test";
import { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

// ─── Constants ───

export const TEST_ORG_ID = "org_test123";
export const TEST_CLERK_ID = "user_test456";

export const testIdentity = {
  subject: TEST_CLERK_ID,
  issuer: "https://test.clerk.com",
  org_id: TEST_ORG_ID,
  org_role: "org:admin",
};

// ─── Setup ───

export function setupTest() {
  const t = convexTest(schema, modules);
  workpoolTest.register(t, "indexingPool");
  workpoolTest.register(t, "generationPool");
  workpoolTest.register(t, "experimentPool");
  workpoolTest.register(t, "scrapingPool");
  workpoolTest.register(t, "livechatAnalysisPool");
  return t;
}

// ─── Shared Seeders ───

export async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      clerkId: TEST_CLERK_ID,
      email: "test@test.com",
      name: "Test User",
      createdAt: Date.now(),
    });
  });
}

export async function seedKB(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("knowledgeBases", {
      orgId: TEST_ORG_ID,
      name: "Test KB",
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

export async function seedDataset(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Dataset",
      strategy: "simple",
      strategyConfig: {},
      questionCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

export async function seedDocument(
  t: ReturnType<typeof convexTest>,
  kbId: Id<"knowledgeBases">,
  overrides?: { title?: string; content?: string; sourceType?: string },
) {
  return await t.run(async (ctx) => {
    const title = overrides?.title ?? "Test Document";
    const content = overrides?.content ?? "# Test\n\nSample document content.";
    const docId = await ctx.db.insert("documents", {
      orgId: TEST_ORG_ID,
      kbId,
      docId: title,
      title,
      content,
      contentLength: content.length,
      metadata: {},
      sourceType: overrides?.sourceType,
      createdAt: Date.now(),
    });

    // Increment denormalized document count on KB
    const kb = await ctx.db.get(kbId);
    if (kb) {
      await ctx.db.patch(kbId, {
        documentCount: (kb.documentCount ?? 0) + 1,
      });
    }

    return docId;
  });
}
