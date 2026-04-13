import type Anthropic from "@anthropic-ai/sdk";
import { parseBotFlowInput } from "./transcript-parser.js";
import { classifyConversation } from "./claude-client.js";
import type {
  RawConversation,
  RawMessage,
  BotFlowInput,
  ConversationMicrotopics,
  MicrotopicsFile,
  MessageType,
  MicrotopicMessage,
  LLMExtractionResult,
} from "./types.js";

// ── System message patterns ──
const SYSTEM_PATTERNS = [
  /^Assigned to .+ by .+$/,
  /^Conversation unassigned by .+$/,
  /.+ self-assigned this conversation$/,
  /.+ added .+$/,
  /^Conversation was marked resolved by .+$/,
];

export function isSystemMessage(text: string): boolean {
  return SYSTEM_PATTERNS.some((p) => p.test(text));
}

// ── Phase A: Preprocessing ──
export interface PreprocessResult {
  botFlowInput?: BotFlowInput;
  systemMessageIds: Set<number>;
  llmInputMessages: RawMessage[];
  skipLLM: boolean;
}

export function preprocessConversation(conv: RawConversation): PreprocessResult {
  let botFlowInput: BotFlowInput | undefined;
  const systemMessageIds = new Set<number>();
  const llmInputMessages: RawMessage[] = [];

  for (let i = 0; i < conv.messages.length; i++) {
    const msg = conv.messages[i];

    // Detect bot flow input (first workflow_input message with comma pattern)
    if (i === 0 && msg.role === "workflow_input") {
      const parsed = parseBotFlowInput(msg.text);
      if (parsed.language !== "unknown" || parsed.intent !== "unknown") {
        botFlowInput = { ...parsed, messageIds: [msg.id] };
        continue; // Exclude from LLM input
      }
    }

    // Classify system messages
    if (msg.role === "workflow_input" && isSystemMessage(msg.text)) {
      systemMessageIds.add(msg.id);
      continue; // Exclude from LLM input
    }

    // Bot flow input that wasn't detected above — still a workflow message
    if (msg.role === "workflow_input") {
      // If it's the first message and we didn't parse it as bot flow, treat as bot flow
      if (i === 0) {
        botFlowInput = { ...parseBotFlowInput(msg.text), messageIds: [msg.id] };
        continue;
      }
      systemMessageIds.add(msg.id);
      continue;
    }

    llmInputMessages.push(msg);
  }

  return {
    botFlowInput,
    systemMessageIds,
    llmInputMessages,
    skipLLM: llmInputMessages.length === 0,
  };
}

// ── Phase C: Assembly ──
function detectLanguage(conv: RawConversation): string {
  for (const label of conv.labels) {
    if (label === "language_english") return "English";
    if (label === "language_arabic") return "Arabic";
  }
  return "unknown";
}

export function assembleConversation(
  conv: RawConversation,
  preprocess: PreprocessResult,
  llmResult: LLMExtractionResult
): ConversationMicrotopics {
  const messageMap = new Map<number, RawMessage>();
  for (const msg of conv.messages) {
    messageMap.set(msg.id, msg);
  }

  // Track which IDs the LLM claimed
  const llmClaimedIds = new Set<number>();
  const validMicrotopics: {
    type: string;
    exchanges: { label: string; messageIds: number[] }[];
    extracted?: { type: string; value: string }[];
  }[] = [];

  for (const mt of llmResult.microtopics) {
    const validExchanges: { label: string; messageIds: number[] }[] = [];
    for (const ex of mt.exchanges) {
      const validIds = ex.messageIds.filter((id) => {
        if (!messageMap.has(id)) return false; // Strip hallucinated IDs
        if (llmClaimedIds.has(id)) return false; // Strip duplicates
        llmClaimedIds.add(id);
        return true;
      });
      if (validIds.length > 0) {
        validExchanges.push({ label: ex.label, messageIds: validIds });
      }
    }
    if (validExchanges.length > 0) {
      validMicrotopics.push({
        type: mt.type,
        exchanges: validExchanges,
        extracted: mt.extracted,
      });
    }
  }

  // Find missing LLM input IDs → append as uncategorized
  const missingIds = preprocess.llmInputMessages
    .map((m) => m.id)
    .filter((id) => !llmClaimedIds.has(id));

  if (missingIds.length > 0) {
    validMicrotopics.push({
      type: "uncategorized",
      exchanges: [{ label: "primary", messageIds: missingIds }],
    });
  }

  // Build system message microtopics (one per system message)
  const systemMicrotopics: { minId: number; microtopic: MessageType }[] = [];
  for (const sysId of preprocess.systemMessageIds) {
    const msg = messageMap.get(sysId)!;
    systemMicrotopics.push({
      minId: sysId,
      microtopic: {
        type: "uncategorized",
        exchanges: [
          {
            label: "primary",
            messages: [{ id: msg.id, role: msg.role, text: msg.text }],
          },
        ],
      },
    });
  }

  // Build LLM microtopics with full messages
  const llmMicrotopics: { minId: number; microtopic: MessageType }[] = [];
  for (const vmt of validMicrotopics) {
    const exchanges = vmt.exchanges.map((ex) => ({
      label: ex.label as "primary" | "follow_up",
      messages: ex.messageIds.map((id) => {
        const msg = messageMap.get(id)!;
        return { id: msg.id, role: msg.role, text: msg.text } as MicrotopicMessage;
      }),
    }));

    const minId = Math.min(...vmt.exchanges.flatMap((e) => e.messageIds));
    llmMicrotopics.push({
      minId,
      microtopic: {
        type: vmt.type as MessageType["type"],
        exchanges,
        ...(vmt.extracted && vmt.extracted.length > 0 ? { extracted: vmt.extracted } : {}),
      },
    });
  }

  // Merge and sort by lowest message ID
  const allMicrotopics = [...systemMicrotopics, ...llmMicrotopics];
  allMicrotopics.sort((a, b) => a.minId - b.minId);

  return {
    conversationId: conv.conversationId,
    language: detectLanguage(conv),
    botFlowInput: preprocess.botFlowInput,
    microtopics: allMicrotopics.map((m) => m.microtopic),
  };
}

// ── Single-conversation classifier ──

/**
 * Classify message types for a single conversation.
 * Returns the array of MessageType objects (sorted by message order).
 * Also returns botFlowInput if detected.
 */
export async function classifyMessageTypes(
  conversation: RawConversation,
  options: {
    claudeClient: Anthropic;
  },
): Promise<{ messageTypes: MessageType[]; botFlowInput?: BotFlowInput }> {
  const preprocess = preprocessConversation(conversation);

  let llmResult: LLMExtractionResult;
  if (preprocess.skipLLM) {
    llmResult = { microtopics: [] };
  } else {
    llmResult = await classifyConversation(
      options.claudeClient,
      preprocess.llmInputMessages,
    );
  }

  const assembled = assembleConversation(conversation, preprocess, llmResult);
  return {
    messageTypes: assembled.microtopics,
    botFlowInput: preprocess.botFlowInput ?? undefined,
  };
}

// ── Batch orchestrator (deprecated) ──

/** @deprecated Use classifyMessageTypes for single conversations */
export async function extractMicrotopics(
  conversations: RawConversation[],
  options: {
    claudeClient: Anthropic;
    source: string;
    limit?: number;
    concurrency?: number;
  }
): Promise<MicrotopicsFile> {
  const { claudeClient, source, limit, concurrency = 10 } = options;
  const toProcess = limit ? conversations.slice(0, limit) : conversations;

  const results: ConversationMicrotopics[] = [];
  const failures: string[] = [];
  let processed = 0;

  // Process in batches
  for (let i = 0; i < toProcess.length; i += concurrency) {
    const batch = toProcess.slice(i, i + concurrency);
    const promises = batch.map(async (conv) => {
      const preprocess = preprocessConversation(conv);

      if (preprocess.skipLLM) {
        // All messages become uncategorized
        return assembleConversation(conv, preprocess, { microtopics: [] });
      }

      try {
        const llmResult = await classifyConversation(
          claudeClient,
          preprocess.llmInputMessages
        );
        return assembleConversation(conv, preprocess, llmResult);
      } catch (err: any) {
        console.error(
          `[microtopics] Failed for conversation ${conv.conversationId}: ${err.message}`
        );
        failures.push(conv.conversationId);
        // Fallback: all messages uncategorized
        return assembleConversation(conv, preprocess, { microtopics: [] });
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    processed += batch.length;
    console.error(`[microtopics] Processed ${processed}/${toProcess.length}`);
  }

  return {
    source,
    generatedAt: new Date().toISOString(),
    model: "claude-sonnet-4-6",
    totalConversations: conversations.length,
    processedConversations: toProcess.length,
    failures,
    conversations: results,
  };
}
