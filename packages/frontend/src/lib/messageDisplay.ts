import type { Doc } from "@convex/_generated/dataModel";

export type ToolCallEntry = {
  toolName: string;
  toolArgs?: string;
  toolResult?: string;
};

export type DisplayItem =
  | { type: "user"; msg: Doc<"messages"> }
  | { type: "assistant"; msg: Doc<"messages"> }
  | { type: "tool_group"; calls: ToolCallEntry[]; key: string };

/**
 * Groups consecutive tool_call/tool_result messages between user→assistant turns
 * into a single tool_group display item rendered above the owning assistant message.
 *
 * DB row order:      user(N), assistant(N+1), tool_call(N+2), tool_result(N+3), ...
 * Display order:     user → tool_group → assistant
 */
export function groupMessagesWithToolCalls(messages: Doc<"messages">[]): DisplayItem[] {
  const toolResultMap = new Map<string, Doc<"messages">>();
  for (const m of messages) {
    if (m.role === "tool_result" && m.toolResult?.toolCallId) {
      toolResultMap.set(m.toolResult.toolCallId, m);
    }
  }

  const toolCallsByAssistant = new Map<string, ToolCallEntry[]>();
  let currentAssistantId: string | null = null;
  for (const m of messages) {
    if (m.role === "assistant") {
      currentAssistantId = m._id;
    } else if (m.role === "tool_call" && currentAssistantId) {
      if (!toolCallsByAssistant.has(currentAssistantId)) {
        toolCallsByAssistant.set(currentAssistantId, []);
      }
      const result = m.toolCall?.toolCallId ? toolResultMap.get(m.toolCall.toolCallId) : undefined;
      toolCallsByAssistant.get(currentAssistantId)!.push({
        toolName: m.toolCall?.toolName ?? "tool",
        toolArgs: m.toolCall?.toolArgs,
        toolResult: result?.toolResult?.result,
      });
    } else if (m.role === "user") {
      currentAssistantId = null;
    }
  }

  const displayItems: DisplayItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      displayItems.push({ type: "user", msg: m });
    } else if (m.role === "assistant") {
      const calls = toolCallsByAssistant.get(m._id);
      if (calls && calls.length > 0) {
        displayItems.push({ type: "tool_group", calls, key: `tg-${m._id}` });
      }
      displayItems.push({ type: "assistant", msg: m });
    }
    // tool_call and tool_result are rendered via the grouped pill, skip individually
  }
  return displayItems;
}
