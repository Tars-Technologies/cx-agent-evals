import { describe, it, expect } from "vitest";
import {
  buildJudgePrompt,
  runLlmJudge,
  scoreOneAsync,
  type JudgeLlmClient,
} from "../convex/evaluator/llmJudge";

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

  it("renders all dimensions with numbering and a fail-if-any instruction", () => {
    const multi = {
      type: "llm_judge" as const,
      llmJudgeConfig: {
        dimensions: [
          { name: "No hallucinated refunds", rubric: "R1", passExamples: [], failExamples: [] },
          { name: "Stays on topic", rubric: "R2", passExamples: [], failExamples: [] },
        ],
        outputFormat: "per_dimension" as const,
        model: "gpt-4o-mini",
        inputContext: ["transcript"] as const,
      },
    };
    const { system } = buildJudgePrompt(multi as any, messages, "");
    expect(system).toContain("Dimension 1: No hallucinated refunds");
    expect(system).toContain("Dimension 2: Stays on topic");
    expect(system.toLowerCase()).toContain("every dimension");
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

function fakeClient(content: string): JudgeLlmClient {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
  };
}

describe("runLlmJudge", () => {
  it("returns passed=true on a pass verdict", async () => {
    const client = fakeClient(JSON.stringify({ answer: "pass", reasoning: "fine" }));
    const v = await runLlmJudge(client, evaluator as any, messages, "");
    expect(v.passed).toBe(true);
    expect(v.justification).toContain("fine");
  });

  it("returns passed=false on a fail verdict", async () => {
    const client = fakeClient(JSON.stringify({ answer: "fail", reasoning: "bad" }));
    const v = await runLlmJudge(client, evaluator as any, messages, "");
    expect(v.passed).toBe(false);
  });

  it("throws on unparseable judge output", async () => {
    const client = fakeClient("not json at all");
    await expect(runLlmJudge(client, evaluator as any, messages, "")).rejects.toThrow();
  });
});

describe("scoreOneAsync dispatch", () => {
  it("uses code scorer for code judges without calling the client", async () => {
    let called = false;
    const client: JudgeLlmClient = {
      chat: { completions: { create: async () => { called = true; return { choices: [] }; } } },
    };
    const codeEvaluator = {
      type: "code",
      codeJudgeConfig: {
        checkType: "string_contains",
        params: { needle: "policy", expectPresent: true },
      },
    };
    const v = await scoreOneAsync(client, codeEvaluator as any, messages, "");
    expect(called).toBe(false);
    expect(v.passed).toBe(true); // "Let me check our policy." contains "policy"
  });

  it("routes llm_judge to the client", async () => {
    const client = fakeClient(JSON.stringify({ answer: "fail", reasoning: "x" }));
    const v = await scoreOneAsync(client, evaluator as any, messages, "");
    expect(v.passed).toBe(false);
  });
});
