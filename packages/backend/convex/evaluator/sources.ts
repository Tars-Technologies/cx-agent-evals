import { internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/** Judge-facing message shape (loose; code judges read extra fields off the row). */
export type JudgeMessage = {
  role: string;
  content: string;
  toolCall?: unknown;
  toolResult?: unknown;
};

/**
 * Pure: map a livechat transcript document to judge-facing messages.
 * - user -> user, human_agent -> assistant, workflow_input -> system (dropped from context)
 * - prefer translatedMessages[].text (matched by id) when available
 */
export function normalizeTranscriptMessages(
  doc: Pick<Doc<"livechatConversations">, "messages" | "translatedMessages">,
): JudgeMessage[] {
  const translation = new Map<number, string>();
  for (const t of doc.translatedMessages ?? []) translation.set(t.id, t.text);

  const roleMap: Record<string, string> = {
    user: "user",
    human_agent: "assistant",
    workflow_input: "system",
  };

  const out: JudgeMessage[] = [];
  for (const m of doc.messages) {
    const role = roleMap[m.role] ?? m.role;
    if (role === "system") continue; // workflow_input excluded from judge context
    out.push({ role, content: translation.get(m.id) ?? m.text });
  }
  return out;
}

const sourceValidator = v.union(
  v.object({
    kind: v.literal("conversation"),
    conversationId: v.id("conversations"),
  }),
  v.object({
    kind: v.literal("transcript"),
    transcriptId: v.id("livechatConversations"),
  }),
);

/**
 * Fetch judge-facing messages for any label/membership source.
 * Conversation sources return full `messages` rows (code judges need toolCall/toolResult).
 * Transcript sources return normalized {role, content} rows.
 */
export const getMessagesForSource = internalQuery({
  args: { source: sourceValidator },
  handler: async (ctx, { source }): Promise<JudgeMessage[]> => {
    if (source.kind === "conversation") {
      const rows = await ctx.runQuery(
        internal.crud.conversations.listMessagesInternal,
        { conversationId: source.conversationId },
      );
      return rows as unknown as JudgeMessage[];
    }
    const doc = await ctx.db.get(source.transcriptId);
    if (!doc) return [];
    return normalizeTranscriptMessages(doc);
  },
});
