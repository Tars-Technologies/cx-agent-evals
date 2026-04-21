import Anthropic from "@anthropic-ai/sdk";
import type { LLMClassifiedMessage, RawMessage } from "./types.js";

export function createClaudeClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
  }
  return new Anthropic({ apiKey: key });
}

/**
 * Classify conversation messages using a template-generated prompt.
 * Returns per-message classification results.
 */
export async function classifyConversation(
  client: Anthropic,
  messages: RawMessage[],
  systemPrompt: string,
  toolSchema: any,
  retries = 3,
): Promise<LLMClassifiedMessage[]> {
  const userContent = `Messages:\n${JSON.stringify(
    messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
  )}\n\nClassify each message using the classify_messages tool.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [toolSchema],
        tool_choice: { type: "tool", name: "classify_messages" },
        messages: [{ role: "user", content: userContent }],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in response");
      }

      const raw = toolBlock.input as { messages: LLMClassifiedMessage[] };
      return raw.messages;
    } catch (err: any) {
      if (attempt < retries && err?.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}
