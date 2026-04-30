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
 * Groups tool_call/tool_result messages within a turn into a single tool_group
 * display item rendered above the owning assistant message.
 *
 * Supports both DB orderings within a turn (segment between user messages):
 *   - Playground streaming order: user → assistant → tool_call → tool_result
 *   - Sim run insertion order:    user → tool_call → tool_result → assistant
 *
 * Display order is the same in both cases: user → tool_group → assistant.
 */
export function groupMessagesWithToolCalls(messages: Doc<"messages">[]): DisplayItem[] {
  const toolResultMap = new Map<string, Doc<"messages">>();
  for (const m of messages) {
    if (m.role === "tool_result" && m.toolResult?.toolCallId) {
      toolResultMap.set(m.toolResult.toolCallId, m);
    }
  }

  // Group tool calls by their owning assistant message. Tool calls and the
  // assistant they belong to live in the same "turn" (segment between user
  // messages). The assistant may come either before the calls (playground
  // streaming order) or after them (sim run insertion order).
  const toolCallsByAssistant = new Map<string, ToolCallEntry[]>();
  let turnStart = 0;
  for (let i = 0; i <= messages.length; i++) {
    const atBoundary = i === messages.length || messages[i].role === "user";
    if (!atBoundary) continue;
    const turn = messages.slice(turnStart, i);
    const assistant = turn.find((m) => m.role === "assistant");
    if (assistant) {
      const calls: ToolCallEntry[] = [];
      for (const m of turn) {
        if (m.role !== "tool_call") continue;
        const result = m.toolCall?.toolCallId
          ? toolResultMap.get(m.toolCall.toolCallId)
          : undefined;
        calls.push({
          toolName: m.toolCall?.toolName ?? "tool",
          toolArgs: m.toolCall?.toolArgs,
          toolResult: result?.toolResult?.result,
        });
      }
      if (calls.length > 0) toolCallsByAssistant.set(assistant._id, calls);
    }
    turnStart = i + 1;
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
