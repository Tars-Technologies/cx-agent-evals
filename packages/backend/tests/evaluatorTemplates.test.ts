import { describe, it, expect } from "vitest";
import { setupTest, testIdentity } from "./helpers";
import { api, internal } from "../convex/_generated/api";
import { scoreOne } from "../convex/evaluator/scoreOne";

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

  it("every template's prefilledConfig is shaped correctly for scoreOne", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const all = await t
      .withIdentity(testIdentity)
      .query(api.evaluator.templates.listAll, {});
    for (const tpl of all) {
      const stubEval = {
        type: tpl.type,
        codeJudgeConfig: tpl.type === "code" ? tpl.prefilledConfig : undefined,
        llmJudgeConfig:
          tpl.type === "llm_judge" ? tpl.prefilledConfig : undefined,
      };
      const messages = [
        { role: "user", content: "hi" },
        { role: "assistant", content: '{"ok": true}' },
      ];
      const v = scoreOne(stubEval, messages);
      expect(typeof v.passed).toBe("boolean");
      expect(typeof v.justification).toBe("string");
      expect(v.justification.length).toBeGreaterThan(0);
      expect(v.justification).not.toMatch(/Unknown checkType/);
    }
  });

  it("rejects unauthenticated query", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    await expect(t.query(api.evaluator.templates.listAll, {})).rejects.toThrow();
  });
});
