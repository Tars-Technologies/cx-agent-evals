"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { ChatBubble } from "@/components/livechat/ChatBubble";
import type { Id } from "@convex/_generated/dataModel";

export function SourceTranscriptPanel({
  sourceTranscriptId,
}: {
  sourceTranscriptId: Id<"livechatConversations">;
}) {
  const conversation = useQuery(api.livechat.orchestration.getConversation, {
    id: sourceTranscriptId,
  });

  // Loading
  if (conversation === undefined) {
    return (
      <div className="p-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-bg-elevated/50 rounded-md h-12 animate-pulse" />
        ))}
      </div>
    );
  }

  // Not found / cross-org / deleted
  if (conversation === null) {
    return (
      <div className="p-6 text-center text-text-dim text-xs">
        Source transcript no longer available.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <div className="text-xs text-text font-medium truncate">
          {conversation.conversationId}
        </div>
        <div className="text-[10px] text-text-dim mt-0.5">
          {conversation.agentName ? `Agent: ${conversation.agentName}` : "No agent"}
          {" · "}
          {conversation.messages.length} message
          {conversation.messages.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {conversation.messages.length === 0 ? (
          <div className="text-center text-text-dim text-xs py-6">
            No messages in this conversation.
          </div>
        ) : (
          conversation.messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              id={msg.id}
              role={msg.role}
              text={msg.text}
              agentName={conversation.agentName}
            />
          ))
        )}
      </div>
    </div>
  );
}
