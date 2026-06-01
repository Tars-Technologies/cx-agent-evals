"use client";

import { useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";

export function RealConversationDetail({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  const conversation = useQuery(api.crud.conversations.get, { id: conversationId });
  const messages = useQuery(api.crud.conversations.listMessages, { conversationId });

  if (conversation === undefined || messages === undefined) {
    return <div className="p-6 text-xs text-text-dim">Loading conversation…</div>;
  }

  const displayItems = groupMessagesWithToolCalls(messages);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm text-text font-semibold">
            {conversation.title || "Conversation"}
          </div>
          <div className="text-[10px] text-text-dim mt-0.5">
            {conversation.source ? `${conversation.source} · ` : ""}
            {new Date(conversation.createdAt).toLocaleString()}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border ${
            conversation.status === "active"
              ? "border-accent/30 text-accent bg-accent/10"
              : "border-border text-text-dim"
          }`}
        >
          {conversation.status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {displayItems.length === 0 && (
          <div className="text-center text-text-dim text-xs mt-12">
            No messages in this conversation.
          </div>
        )}

        {displayItems.map((item) => {
          if (item.type === "user") {
            return (
              <div key={item.msg._id} className="flex justify-end">
                <div className="max-w-[80%] bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
                  <p className="text-sm text-text whitespace-pre-wrap">{item.msg.content}</p>
                </div>
              </div>
            );
          }
          if (item.type === "tool_group") {
            return <ToolCallGroup key={item.key} calls={item.calls} isLive={false} />;
          }
          if (item.type === "assistant") {
            const msg = item.msg;
            const isError = msg.status === "error";
            return (
              <div key={msg._id} className="flex justify-start">
                <div className="max-w-[80%]">
                  <div className="text-text-dim text-[8px] mb-0.5 ml-1">Agent</div>
                  <div
                    className={`bg-bg-elevated border rounded-xl px-3 py-2 ${
                      isError ? "border-red-500/30" : "border-border"
                    }`}
                  >
                    {isError ? (
                      <p className="text-sm whitespace-pre-wrap text-red-400">{msg.content}</p>
                    ) : (
                      <div className="text-sm text-text prose-agent">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content || ""}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
