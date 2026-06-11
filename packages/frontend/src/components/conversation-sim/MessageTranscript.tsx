"use client";

import type { Doc } from "@convex/_generated/dataModel";
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";

/**
 * Renders a conversation transcript with tool calls grouped into collapsible
 * pills (user → tool_group → assistant). Shared by the simulation run viewer
 * and the error-analysis annotate view so both show the same thing.
 */
export function MessageTranscript({
  messages,
  isLive = false,
}: {
  messages: Doc<"messages">[];
  isLive?: boolean;
}) {
  return (
    <>
      {groupMessagesWithToolCalls(messages).map((item) => {
        if (item.type === "tool_group") {
          return (
            <ToolCallGroup key={item.key} calls={item.calls} isLive={isLive} />
          );
        }
        const msg = item.msg;
        const isUser = msg.role === "user";
        return (
          <div
            key={msg._id}
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
              {msg.content}
            </div>
          </div>
        );
      })}
    </>
  );
}
