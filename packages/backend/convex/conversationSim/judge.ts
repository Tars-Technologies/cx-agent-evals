"use node";

// LLM judge — plain async function (NOT a Convex action).
// Called directly from the simulation action (Task 7) which is also "use node".

import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";

export interface JudgeConfig {
  rubric: string;
  passExamples: string[];
  failExamples: string[];
  model: string;
  inputContext: Array<"transcript" | "tool_calls" | "kb_documents">;
}

export interface JudgeContext {
  transcript: string;
  toolCalls?: string;
  kbDocuments?: string;
}

export interface JudgeResult {
  passed: boolean;
  justification: string;
}

export async function runLLMJudge(
  config: JudgeConfig,
  context: JudgeContext,
): Promise<JudgeResult> {
  const contextParts: string[] = [];

  if (config.inputContext.includes("transcript")) {
    contextParts.push(`## Conversation Transcript\n${context.transcript}`);
  }
  if (config.inputContext.includes("tool_calls") && context.toolCalls) {
    contextParts.push(`## Tool Calls\n${context.toolCalls}`);
  }
  if (config.inputContext.includes("kb_documents") && context.kbDocuments) {
    contextParts.push(`## Retrieved KB Documents\n${context.kbDocuments}`);
  }

  const prompt = `You are an evaluation judge for a customer support AI agent.

## Rubric
${config.rubric}

## Examples of PASS
${config.passExamples.map((e) => `- ${e}`).join("\n")}

## Examples of FAIL
${config.failExamples.map((e) => `- ${e}`).join("\n")}

${contextParts.join("\n\n")}

Evaluate the agent's performance against the rubric. Respond with EXACTLY this JSON format:
{"passed": true/false, "justification": "Brief justification (1-2 sentences)"}

Respond ONLY with the JSON object.`;

  const result = await generateText({
    model: resolveModel(config.model),
    prompt,
    temperature: 0,
  });

  try {
    const parsed = JSON.parse(result.text.trim());
    return {
      passed: Boolean(parsed.passed),
      justification: String(parsed.justification ?? "No justification provided"),
    };
  } catch {
    // Fallback: try to extract pass/fail from the raw text
    const text = result.text.toLowerCase();
    const passed =
      text.includes('"passed": true') || text.includes('"passed":true');
    return {
      passed,
      justification: `Judge response (parse fallback): ${result.text.slice(0, 200)}`,
    };
  }
}
