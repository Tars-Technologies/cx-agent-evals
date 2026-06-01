import { scoreOne, type Verdict } from "./scoreOne";

/** Structural subset of the OpenAI client used by the judge — enables injection + mocking. */
export interface JudgeLlmClient {
  chat: {
    completions: {
      create(args: {
        model: string;
        temperature?: number;
        response_format?: { type: "json_object" };
        messages: { role: "system" | "user"; content: string }[];
      }): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
}

type Dimension = {
  name: string;
  rubric: string;
  passExamples: string[];
  failExamples: string[];
};

function renderMessages(messages: any[], includeToolCalls: boolean): string {
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role ?? "unknown";
    if (m.content) lines.push(`${role}: ${m.content}`);
    if (includeToolCalls && m.toolCall) {
      lines.push(`${role} [tool_call]: ${JSON.stringify(m.toolCall)}`);
    }
    if (includeToolCalls && m.toolResult) {
      lines.push(`${role} [tool_result]: ${JSON.stringify(m.toolResult)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the system + user prompt for an LLM judge.
 * Pure — no network. `fewShot` is a pre-rendered block (may be empty).
 *
 * Slice 1 simplification: all dimensions are evaluated in a single call with
 * model-side fail-if-any (PASS only if every dimension is satisfied). We do not
 * score dimensions individually, and `llmJudgeConfig.outputFormat` is intentionally
 * not read yet (per-dimension code-side aggregation is deferred to a later slice).
 */
export function buildJudgePrompt(
  evaluator: { llmJudgeConfig?: { dimensions: Dimension[]; inputContext: string[] } },
  messages: any[],
  fewShot: string,
): { system: string; user: string } {
  const cfg = evaluator.llmJudgeConfig;
  const dimensions = cfg?.dimensions ?? [];
  const includeToolCalls = (cfg?.inputContext ?? []).includes("tool_calls");

  const dimBlocks = dimensions
    .map((d, i) => {
      const pass = d.passExamples.length
        ? d.passExamples.map((e) => `  - PASS: ${e}`).join("\n")
        : "  - (none)";
      const fail = d.failExamples.length
        ? d.failExamples.map((e) => `  - FAIL: ${e}`).join("\n")
        : "  - (none)";
      return `Dimension ${i + 1}: ${d.name}\nRubric: ${d.rubric}\nExamples:\n${pass}\n${fail}`;
    })
    .join("\n\n");

  const system =
    `You are a strict pass/fail judge for a conversational AI agent. ` +
    `Evaluate the conversation against the dimension(s) below. ` +
    `A conversation PASSES only if it satisfies every dimension; otherwise it FAILS.\n\n` +
    `${dimBlocks}\n\n` +
    (fewShot ? `Worked examples:\n${fewShot}\n\n` : "") +
    `Respond with a single JSON object and nothing else, of the form ` +
    `{ "answer": "pass" | "fail", "reasoning": "<one or two sentences>" }.`;

  const user =
    `Conversation transcript:\n\n${renderMessages(messages, includeToolCalls)}\n\n` +
    `Return your JSON verdict now.`;

  return { system, user };
}
