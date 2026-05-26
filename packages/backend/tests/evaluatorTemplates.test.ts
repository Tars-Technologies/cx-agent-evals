import { describe, it, expect } from "vitest";
import { setupTest, testIdentity } from "./helpers";
import { api, internal } from "../convex/_generated/api";

describe("evaluatorTemplates", () => {
  it("seedAll inserts the built-in template library", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const all = await t.withIdentity(testIdentity).query(api.evaluator.templates.listAll, {});
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it("seedAll is idempotent", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const first = await t.withIdentity(testIdentity).query(api.evaluator.templates.listAll, {});
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const second = await t.withIdentity(testIdentity).query(api.evaluator.templates.listAll, {});
    expect(second.length).toBe(first.length);
  });

  it("byCategory filters by category", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const safety = await t.withIdentity(testIdentity).query(api.evaluator.templates.byCategory, { category: "safety" });
    expect(safety.length).toBeGreaterThan(0);
    for (const tpl of safety) expect(tpl.category).toBe("safety");
  });

  it("templates cover both code and llm_judge types", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const all = await t.withIdentity(testIdentity).query(api.evaluator.templates.listAll, {});
    const types = new Set(all.map(t => t.type));
    expect(types.has("code")).toBe(true);
    expect(types.has("llm_judge")).toBe(true);
  });

  it("rejects unauthenticated query", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    await expect(t.query(api.evaluator.templates.listAll, {})).rejects.toThrow();
  });
});
