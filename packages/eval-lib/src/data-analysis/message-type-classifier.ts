import type Anthropic from "@anthropic-ai/sdk";
import { parseBotFlowInput } from "./transcript-parser.js";
import { classifyConversation } from "./claude-client.js";
import { buildClassificationPrompt, buildToolSchema } from "./prompt-builder.js";
import { groupIntoBlocks } from "./block-grouper.js";
import { getTemplate } from "./templates/index.js";
import type {
  RawConversation,
  RawMessage,
  BotFlowInput,
  ClassifiedMessage,
  ConversationBlock,
  LLMClassifiedMessage,
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

// ── Preprocessing (unchanged logic) ──
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

    if (i === 0 && msg.role === "workflow_input") {
      const parsed = parseBotFlowInput(msg.text);
      if (parsed.language !== "unknown" || parsed.intent !== "unknown") {
        botFlowInput = { ...parsed, messageIds: [msg.id] };
        continue;
      }
    }

    if (msg.role === "workflow_input" && isSystemMessage(msg.text)) {
      systemMessageIds.add(msg.id);
      continue;
    }

    if (msg.role === "workflow_input") {
      if (i === 0) {
        botFlowInput = { ...parseBotFlowInput(msg.text), messageIds: [msg.id] };
        continue;
      }
      systemMessageIds.add(msg.id);
      continue;
    }

    llmInputMessages.push(msg);
  }

  return { botFlowInput, systemMessageIds, llmInputMessages, skipLLM: llmInputMessages.length === 0 };
}

// ── New classifier entry point ──
export interface ClassificationResult {
  classifiedMessages: ClassifiedMessage[];
  blocks: ConversationBlock[];
  botFlowInput?: BotFlowInput;
}

export async function classifyMessageTypes(
  conversation: RawConversation,
  options: {
    claudeClient: Anthropic;
    templateId: string;
  },
): Promise<ClassificationResult> {
  const template = getTemplate(options.templateId);
  if (!template) throw new Error(`Unknown template: ${options.templateId}`);

  const preprocess = preprocessConversation(conversation);

  let llmMessages: LLMClassifiedMessage[] = [];
  if (!preprocess.skipLLM) {
    const systemPrompt = buildClassificationPrompt(template);
    const toolSchema = buildToolSchema(template);
    llmMessages = await classifyConversation(
      options.claudeClient,
      preprocess.llmInputMessages,
      systemPrompt,
      toolSchema,
    );
  }

  // Convert to ClassifiedMessage (add source)
  const classifiedMessages: ClassifiedMessage[] = llmMessages.map(m => ({
    ...m,
    source: "llm" as const,
  }));

  // Build role map for block grouper
  const roleMap = new Map<number, string>();
  for (const msg of preprocess.llmInputMessages) {
    roleMap.set(msg.id, msg.role);
  }

  const blocks = groupIntoBlocks(classifiedMessages, roleMap);

  return {
    classifiedMessages,
    blocks,
    botFlowInput: preprocess.botFlowInput,
  };
}
