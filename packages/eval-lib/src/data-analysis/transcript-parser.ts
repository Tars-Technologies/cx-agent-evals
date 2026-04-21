import type { RawMessage, MessageRole, BotFlowInput } from "./types.js";

const SPEAKER_REGEX = /^(Visitor|Agent|Unknown)\s*:\s*/;

const SPEAKER_ROLE_MAP: Record<string, MessageRole> = {
  Visitor: "user",
  Agent: "human_agent",
  Unknown: "workflow_input",
};

const KNOWN_LANGUAGES = ["English", "Arabic"];
const NOISE_PHRASES = ["-No Input-", "Continue in English", "تبديل إلى العربية"];

/**
 * Parse a transcript string (` || `-delimited) into an array of RawMessage objects.
 * Purely deterministic — no AI involved.
 */
export function parseTranscript(transcript: string): RawMessage[] {
  if (!transcript || !transcript.trim()) return [];

  const segments = transcript.split(" || ");
  const messages: RawMessage[] = [];
  let id = 1;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const match = trimmed.match(SPEAKER_REGEX);
    let role: MessageRole;
    let text: string;

    if (match) {
      role = SPEAKER_ROLE_MAP[match[1]];
      text = trimmed.slice(match[0].length);
    } else {
      role = "workflow_input";
      text = trimmed;
    }

    messages.push({ id: id++, role, text });
  }

  return messages;
}

/**
 * Parse a bot flow input message into structured intent/language.
 * Bot flow messages are comma-separated values like:
 * "Continue in English, -No Input-, New Postpaid Plan, English,"
 */
export function parseBotFlowInput(text: string): BotFlowInput {
  const result: BotFlowInput = {
    rawText: text,
    intent: "unknown",
    language: "unknown",
    messageIds: [],
  };

  if (!text || !text.trim()) return result;

  // Must have at least 2 commas to be the structured bot flow pattern
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount < 2) return result;

  const tokens = text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Filter out noise phrases
  const cleaned = tokens.filter(
    (t) => !NOISE_PHRASES.some((noise) => t === noise)
  );

  // Find and extract language (last matching token)
  let language = "unknown";
  const withoutLanguage: string[] = [];
  let foundLanguage = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (!foundLanguage && KNOWN_LANGUAGES.includes(cleaned[i])) {
      language = cleaned[i];
      foundLanguage = true;
    } else {
      withoutLanguage.unshift(cleaned[i]);
    }
  }

  result.language = language;

  // Remaining substantive tokens are intent candidates
  const intents = withoutLanguage.filter((t) => t.length > 1);

  if (intents.length === 1) {
    result.intent = intents[0];
  } else if (intents.length > 1) {
    result.intent = intents.join(" / ");
  }

  return result;
}
