import Anthropic from "@anthropic-ai/sdk";

const TRANSLATION_SYSTEM_PROMPT = `You are translating customer support chat messages to English.
Translate each message preserving the meaning and conversational tone.
Return translations using the translate_messages tool.`;

const TRANSLATION_TOOL_SCHEMA = {
  name: "translate_messages",
  description: "Return English translations for the given messages",
  input_schema: {
    type: "object" as const,
    properties: {
      translations: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "number" as const },
            text: { type: "string" as const },
          },
          required: ["id", "text"],
        },
      },
    },
    required: ["translations"],
  },
};

interface TranslationResult {
  translations: Array<{ id: number; text: string }>;
}

/**
 * Check if text contains non-Latin script characters that likely need translation.
 * Detects Arabic, CJK, Cyrillic, Thai, Devanagari, Hebrew, Korean, etc.
 * Excludes common non-ASCII characters in English text (smart quotes, em dashes,
 * accented Latin letters, etc.).
 */
export function needsTranslation(text: string): boolean {
  // Match characters NOT in Latin, Common, or Inherited Unicode scripts.
  // Common includes digits, punctuation, symbols, whitespace.
  // Inherited includes combining marks used with Latin.
  // This catches Arabic, CJK, Cyrillic, Thai, Devanagari, Hebrew, Hangul, etc.
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text);
}

/** @deprecated Use needsTranslation */
export const hasNonAscii = needsTranslation;

/**
 * Translate non-English messages in a conversation to English.
 * Only sends messages with non-ASCII characters to Claude.
 * Returns sparse array of translations (only for messages that were translated).
 */
export async function translateMessages(
  messages: Array<{ id: number; text: string }>,
  client: Anthropic,
  retries = 3,
): Promise<Array<{ id: number; text: string }>> {
  // Filter to only non-English messages
  const nonEnglish = messages.filter((m) => needsTranslation(m.text));

  if (nonEnglish.length === 0) {
    return []; // All messages are English
  }

  const userContent = `Translate these messages to English:\n${JSON.stringify(
    nonEnglish.map((m) => ({ id: m.id, text: m.text })),
  )}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: TRANSLATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        tools: [TRANSLATION_TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "translate_messages" },
      });

      const toolBlock = response.content.find(
        (block) => block.type === "tool_use",
      );
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in translation response");
      }

      const result = toolBlock.input as TranslationResult;
      return result.translations;
    } catch (err: unknown) {
      if (
        err instanceof Anthropic.APIError &&
        err.status === 429 &&
        attempt < retries - 1
      ) {
        await new Promise((r) =>
          setTimeout(r, 1000 * Math.pow(2, attempt)),
        );
        continue;
      }
      throw err;
    }
  }

  throw new Error("Translation failed after all retries");
}
