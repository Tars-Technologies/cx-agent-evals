import type { ClassifiedMessage, ConversationBlock } from "./types.js";

/**
 * Groups classified messages into conversation blocks deterministically.
 *
 * Rules:
 * - New block starts when a user message appears after an agent message
 * - Consecutive user messages stay in the same block
 * - Block label/metadata comes from the first user message in the block
 * - If conversation starts with agent messages, they join the first block
 *
 * @param messages - Classified messages in conversation order
 * @param messageRoles - Map of messageId → original role ("user" | "human_agent" | "workflow_input")
 */
export function groupIntoBlocks(
  messages: ClassifiedMessage[],
  messageRoles: Map<number, string>,
): ConversationBlock[] {
  if (messages.length === 0) return [];

  const blocks: ConversationBlock[] = [];
  let currentBlock: { messageIds: number[]; firstUserMsg?: ClassifiedMessage } = {
    messageIds: [],
  };
  let lastRole: string | null = null;

  for (const msg of messages) {
    const role = messageRoles.get(msg.messageId) ?? "user";
    const isUser = role === "user";

    // Start new block when user message appears after agent message,
    // but only if the current block already has a user message (i.e. it's not
    // just leading agent messages before the first user turn).
    if (isUser && lastRole === "human_agent" && currentBlock.firstUserMsg) {
      // Flush current block
      blocks.push(buildBlock(currentBlock.firstUserMsg, currentBlock.messageIds));
      currentBlock = { messageIds: [], firstUserMsg: undefined };
    }

    currentBlock.messageIds.push(msg.messageId);
    if (isUser && !currentBlock.firstUserMsg) {
      currentBlock.firstUserMsg = msg;
    }

    lastRole = role;
  }

  // Flush final block
  if (currentBlock.messageIds.length > 0 && currentBlock.firstUserMsg) {
    blocks.push(buildBlock(currentBlock.firstUserMsg, currentBlock.messageIds));
  } else if (currentBlock.messageIds.length > 0) {
    // Edge case: only agent messages, no user messages at all
    blocks.push({
      label: "uncategorized",
      confidence: "high",
      isFollowUp: false,
      messageIds: currentBlock.messageIds,
    });
  }

  return blocks;
}

function buildBlock(anchor: ClassifiedMessage, messageIds: number[]): ConversationBlock {
  return {
    label: anchor.label,
    intentOpenCode: anchor.intentOpenCode,
    confidence: anchor.confidence,
    isFollowUp: anchor.isFollowUp,
    followUpType: anchor.followUpType,
    standaloneVersion: anchor.standaloneVersion,
    messageIds,
  };
}
