"use client";

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { FeedItemExpanded } from "./FeedItemExpanded";
import type { MessageTypeItem } from "./types";

interface NewFeedItem {
  conversationId: string;
  convDocId: Id<"livechatConversations">;
  visitorName: string;
  agentName: string;
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: string;
  standaloneVersion?: string;
  messageId: number;
  originalText: string;
  agentResponse?: string;
  precedingMessages: Array<{ id: number; role: string; text: string }>;
}

export function MessageTypeFeed({ items, newItems }: { items: MessageTypeItem[]; newItems?: NewFeedItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Use new format if available
  if (newItems && newItems.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        {newItems.map((item) => {
          const itemKey = `${item.conversationId}-${item.messageId}`;
          const isExpanded = expandedId === itemKey;

          return (
            <div
              key={itemKey}
              className="bg-bg-surface rounded-md border border-border border-l-[3px] border-l-accent mb-2"
            >
              <div
                className="p-2.5 cursor-pointer hover:bg-bg-hover/30"
                onClick={() => setExpandedId(isExpanded ? null : itemKey)}
              >
                {/* Header */}
                <div className="flex items-center gap-1.5 text-[10px] text-text-dim mb-1">
                  <span>{item.visitorName || "Unknown"}</span>
                  <span>·</span>
                  <span>#{item.conversationId}</span>
                  {item.intentOpenCode && (
                    <>
                      <span>·</span>
                      <span className="bg-bg-hover px-1 rounded text-[8px]">{item.intentOpenCode}</span>
                    </>
                  )}
                  {item.isFollowUp && (
                    <span className="text-[8px] text-[#c084fc] bg-[#c084fc15] px-1 rounded">
                      {item.followUpType ?? "follow-up"}
                    </span>
                  )}
                  <span className={`w-1.5 h-1.5 rounded-full ${item.confidence === "high" ? "bg-[#6ee7b7]" : "bg-[#fbbf24]"}`} />
                </div>

                {/* Main text: standalone version or original */}
                <div className="text-accent-bright text-xs mb-1">
                  {item.standaloneVersion ?? item.originalText}
                </div>

                {/* Show original if standalone differs */}
                {item.standaloneVersion && item.standaloneVersion !== item.originalText && (
                  <div className="text-text-dim text-[10px] italic mb-1">
                    Original: {item.originalText}
                  </div>
                )}

                {/* Agent response */}
                {item.agentResponse && (
                  <div className="text-text-muted text-xs pl-2 border-l-2 border-border mt-1">
                    {item.agentResponse}
                  </div>
                )}
              </div>

              {/* Expanded view */}
              {isExpanded && (
                <FeedItemExpanded
                  conversationId={item.convDocId}
                  messageId={item.messageId}
                  originalText={item.originalText}
                  standaloneVersion={item.standaloneVersion}
                  isFollowUp={item.isFollowUp}
                  precedingMessages={item.precedingMessages}
                  onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Old format fallback
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {items.map((item, i) => {
        const primaryExchange = item.messageType.exchanges.find((e) => e.label === "primary");
        const userMsgs = primaryExchange?.messages.filter((m) => m.role === "user") ?? [];
        const agentMsgs = primaryExchange?.messages.filter((m) => m.role === "human_agent") ?? [];

        return (
          <div
            key={`${item.conversationId}-${i}`}
            className="bg-bg-surface rounded-md border border-border border-l-[3px] border-l-accent mb-2 p-2.5"
          >
            <div className="text-text-dim text-[10px] mb-1">
              {item.visitorName || "Unknown"} · #{item.conversationId} · {item.agentName}
            </div>
            {userMsgs.map((msg) => (
              <div key={msg.id} className="text-accent-bright text-xs mb-1">{msg.text}</div>
            ))}
            {agentMsgs.length > 0 && (
              <div className="text-text-muted text-xs pl-2 border-l-2 border-border mt-1">
                {agentMsgs.map((msg) => (<div key={msg.id} className="mb-0.5">{msg.text}</div>))}
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="text-text-dim text-xs text-center p-4">No items for this type</div>
      )}
    </div>
  );
}

export type { NewFeedItem };
