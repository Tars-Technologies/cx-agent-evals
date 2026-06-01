"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { MessageTranscript } from "@/components/conversation-sim/MessageTranscript";

export type SourceRef =
  | { kind: "conversation"; conversationId: Id<"conversations"> }
  | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

/**
 * Renders the transcript for a conversation or livechat-transcript source.
 * Conversations reuse MessageTranscript (tool calls included); livechat
 * transcripts render as simple message bubbles. Handles its own loading.
 */
export function SourceTranscript({ source }: { source: SourceRef }) {
  if (source.kind === "conversation") {
    return <ConversationTranscript conversationId={source.conversationId} />;
  }
  return <LivechatTranscript transcriptId={source.transcriptId} />;
}

function ConversationTranscript({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  const messages = useQuery(api.crud.conversations.listMessages, {
    conversationId,
  });
  if (messages === undefined) {
    return <div className="text-[11px] text-text-dim italic">Loading…</div>;
  }
  if (messages.length === 0) {
    return <div className="text-[11px] text-text-dim italic">No messages.</div>;
  }
  return <MessageTranscript messages={messages} />;
}

function LivechatTranscript({
  transcriptId,
}: {
  transcriptId: Id<"livechatConversations">;
}) {
  const t = useQuery(api.livechat.orchestration.getConversation, {
    id: transcriptId,
  });
  if (t === undefined) {
    return <div className="text-[11px] text-text-dim italic">Loading…</div>;
  }
  if (t === null) {
    return (
      <div className="text-[11px] text-text-dim italic">
        Transcript not found.
      </div>
    );
  }
  return (
    <>
      {t.messages.map((m) => {
        if (m.role === "workflow_input") {
          return (
            <div key={m.id} className="text-center my-1">
              <span className="text-text-dim text-[10px] bg-bg-surface px-2 py-0.5 rounded-full">
                {m.text}
              </span>
            </div>
          );
        }
        const isUser = m.role === "user";
        return (
          <div
            key={m.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}
          >
            <div
              className={`max-w-[70%] px-2.5 py-1.5 text-xs whitespace-pre-wrap text-white ${
                isUser
                  ? "bg-accent-dim rounded-lg rounded-br-sm"
                  : "bg-bg-surface border border-border rounded-lg rounded-bl-sm"
              }`}
            >
              <div
                className={`text-[9px] mb-0.5 ${
                  isUser ? "text-white/50" : "text-text-dim"
                }`}
              >
                {isUser ? "User" : "Agent"}
              </div>
              {m.text}
            </div>
          </div>
        );
      })}
    </>
  );
}
