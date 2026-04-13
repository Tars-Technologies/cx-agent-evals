"use client";

import type { MessageTypeItem } from "./types";

export function MessageTypeFeed({ items }: { items: MessageTypeItem[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {items.map((item, i) => {
        const primaryExchange = item.messageType.exchanges.find(
          (e) => e.label === "primary"
        );
        const userMsgs = primaryExchange?.messages.filter(
          (m) => m.role === "user"
        ) ?? [];
        const agentMsgs = primaryExchange?.messages.filter(
          (m) => m.role === "human_agent"
        ) ?? [];

        return (
          <div
            key={`${item.conversationId}-${i}`}
            className="bg-bg-surface rounded-md border border-border border-l-[3px] border-l-accent mb-2 p-2.5"
          >
            <div className="text-text-dim text-[10px] mb-1">
              {item.visitorName || "Unknown"} · #{item.conversationId} · {item.agentName}
            </div>
            {userMsgs.map((msg) => (
              <div key={msg.id} className="text-accent-bright text-xs mb-1">
                {msg.text}
              </div>
            ))}
            {agentMsgs.length > 0 && (
              <div className="text-text-muted text-xs pl-2 border-l-2 border-border mt-1">
                {agentMsgs.map((msg) => (
                  <div key={msg.id} className="mb-0.5">
                    {msg.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="text-text-dim text-xs text-center p-4">
          No items for this type
        </div>
      )}
    </div>
  );
}
