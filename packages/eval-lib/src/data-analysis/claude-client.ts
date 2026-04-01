import Anthropic from "@anthropic-ai/sdk";
import type {
  RawMessage,
  LLMExtractionResult,
} from "./types.js";

const SYSTEM_PROMPT = `You are analyzing customer support chat transcripts from a telecom company (Vodafone Qatar).

Your task is to segment the conversation into microtopics and classify each one. You will receive messages with their IDs. Return ONLY message IDs and classifications — do NOT reproduce message text.

Conversations may be in English, Arabic, or a mix of both. Classify based on the semantic content regardless of language.

Microtopic types:
- identity_info: User shares personal information (name, phone, email, address, QID) or agent asks for/confirms it
- question: User asks a factual question about products, services, pricing, plans, coverage, features, etc.
- request: User makes a request, negotiation, or states a preference (e.g., "I want X", "Can you give me Y", "I need a discount")
- confirmation: Simple acknowledgments, yes/no responses, or brief confirmations between user and agent
- greeting: Hello/welcome exchanges
- closing: Thank you/goodbye/session-end exchanges
- uncategorized: Anything that doesn't clearly fit the above

Rules:
1. Every message ID from the input MUST appear in exactly one microtopic
2. Message IDs within each exchange must be in ascending order
3. Each microtopic has "exchanges". The "primary" exchange contains the core interaction. If the agent then asks a follow-up that continues the same topic, those messages go in a "follow_up" exchange.
4. Merge adjacent identity_info interactions into one microtopic when they flow naturally (e.g., agent asks for name, then phone, then address)
5. For identity_info microtopics, include an "extracted" array with structured data (type + value)
6. When a message is ambiguous, prefer the more specific type over "uncategorized"
7. A single message from the agent (like a greeting or closing template) can be its own microtopic`;

const TOOL_SCHEMA = {
  name: "classify_microtopics",
  description: "Classify conversation messages into microtopics",
  input_schema: {
    type: "object" as const,
    properties: {
      microtopics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "identity_info",
                "question",
                "request",
                "confirmation",
                "greeting",
                "closing",
                "uncategorized",
              ],
            },
            exchanges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", enum: ["primary", "follow_up"] },
                  messageIds: { type: "array", items: { type: "number" } },
                },
                required: ["label", "messageIds"],
              },
            },
            extracted: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  value: { type: "string" },
                },
                required: ["type", "value"],
              },
            },
          },
          required: ["type", "exchanges"],
        },
      },
    },
    required: ["microtopics"],
  },
};

export function createClaudeClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set."
    );
  }
  return new Anthropic({ apiKey: key });
}

/**
 * Send a conversation's messages to Claude for microtopic classification.
 * Returns ID-only results — no text reproduction.
 */
export async function classifyConversation(
  client: Anthropic,
  messages: RawMessage[],
  retries = 3
): Promise<LLMExtractionResult> {
  const userContent = `Messages:\n${JSON.stringify(
    messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
  )}\n\nClassify these messages into microtopics using the classify_microtopics tool.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "classify_microtopics" },
        messages: [{ role: "user", content: userContent }],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in response");
      }

      return toolBlock.input as LLMExtractionResult;
    } catch (err: any) {
      if (attempt < retries && err?.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.error(`[claude] Rate limited, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}
