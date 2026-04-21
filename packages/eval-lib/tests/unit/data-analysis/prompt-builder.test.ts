import { describe, it, expect } from "vitest";
import { buildClassificationPrompt, buildToolSchema } from "../../../src/data-analysis/prompt-builder.js";
import { CX_TRANSCRIPT_ANALYSIS } from "../../../src/data-analysis/templates/index.js";

describe("buildClassificationPrompt", () => {
  it("includes all category descriptions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("question");
    expect(prompt).toContain("request");
    expect(prompt).toContain("identity_info");
    expect(prompt).toContain("greeting");
    expect(prompt).toContain("closing");
    expect(prompt).toContain("confirmation");
    expect(prompt).toContain("uncategorized");
  });

  it("includes few-shot examples", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("What are the available 5G plans");
    expect(prompt).toContain("I'd like to upgrade");
  });

  it("includes disambiguation rules", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("phrased as a question but");
  });

  it("includes agent role definitions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("response");
    expect(prompt).toContain("proactive");
    expect(prompt).toContain("procedural");
  });

  it("includes follow-up detection instructions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("isFollowUp");
    expect(prompt).toContain("standaloneVersion");
  });
});

describe("buildToolSchema", () => {
  it("returns valid tool schema with enum from template", () => {
    const schema = buildToolSchema(CX_TRANSCRIPT_ANALYSIS);
    expect(schema.name).toBe("classify_messages");
    const labelEnum = schema.input_schema.properties.messages.items.properties.label.enum;
    expect(labelEnum).toContain("question");
    expect(labelEnum).toContain("response");
    expect(labelEnum).toContain("proactive");
  });
});
