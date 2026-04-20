import { describe, it, expect } from "vitest";
import { getTemplate, listTemplates } from "../../../src/data-analysis/templates/index.js";

describe("Template Registry", () => {
  it("lists all built-in templates", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(2);
    expect(templates.map(t => t.id)).toContain("cx-transcript-analysis");
    expect(templates.map(t => t.id)).toContain("eval-dataset-extraction");
  });

  it("gets template by ID", () => {
    const tpl = getTemplate("cx-transcript-analysis");
    expect(tpl).toBeDefined();
    expect(tpl!.categories.length).toBe(7);
    expect(tpl!.agentRoles.length).toBe(3);
    expect(tpl!.disambiguationRules.length).toBeGreaterThan(0);
  });

  it("returns undefined for unknown template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });

  it("cx-transcript-analysis has few-shot examples for each category", () => {
    const tpl = getTemplate("cx-transcript-analysis")!;
    for (const cat of tpl.categories) {
      expect(cat.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("eval-dataset-extraction has 3 categories", () => {
    const tpl = getTemplate("eval-dataset-extraction")!;
    expect(tpl.categories.map(c => c.id)).toEqual(["question", "request", "other"]);
  });
});
