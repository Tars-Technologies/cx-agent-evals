import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../convex/evaluator/llmJudge";

const evaluator = {
  type: "llm_judge" as const,
  llmJudgeConfig: {
    dimensions: [
      {
        name: "No hallucinated refunds",
        rubric: "Pass if the agent never promises a refund it cannot grant.",
        passExamples: ["Agent declines politely."],
        failExamples: ["Agent promises an instant refund."],
      },
    ],
    outputFormat: "per_dimension" as const,
    model: "gpt-4o-mini",
    inputContext: ["transcript"] as const,
  },
};

const messages = [
  { role: "user", content: "Can I get a refund?" },
  { role: "assistant", content: "Let me check our policy." },
];

describe("buildJudgePrompt", () => {
  it("includes rubric, pass/fail examples and the JSON output contract", () => {
    const { system, user } = buildJudgePrompt(evaluator as any, messages, "");
    expect(system).toContain("No hallucinated refunds");
    expect(system).toContain("Pass if the agent never promises");
    expect(system).toContain("Agent promises an instant refund.");
    expect(system.toLowerCase()).toContain("json");
    expect(system).toContain('"answer"');
    expect(user).toContain("Can I get a refund?");
    expect(user).toContain("Let me check our policy.");
  });

  it("renders a few-shot block when provided", () => {
    const fewShot = "### Example 1\nVerdict: fail\n";
    const { system } = buildJudgePrompt(evaluator as any, messages, fewShot);
    expect(system).toContain("### Example 1");
  });

  it("includes tool calls only when inputContext requests tool_calls", () => {
    const withTool = [
      ...messages,
      { role: "assistant", content: "", toolCall: { name: "lookupOrder", args: { id: 7 } } },
    ];
    const off = buildJudgePrompt(evaluator as any, withTool, "");
    expect(off.user).not.toContain("lookupOrder");

    const evWithTools = {
      ...evaluator,
      llmJudgeConfig: { ...evaluator.llmJudgeConfig, inputContext: ["transcript", "tool_calls"] },
    };
    const on = buildJudgePrompt(evWithTools as any, withTool, "");
    expect(on.user).toContain("lookupOrder");
  });
});
