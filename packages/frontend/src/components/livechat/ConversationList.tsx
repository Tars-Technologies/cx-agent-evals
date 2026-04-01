"use client";

import { useState } from "react";
import type { RawConversation } from "rag-evaluation-system/data-analysis";

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  renderBadges,
}: {
  conversations: RawConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderBadges?: (conv: RawConversation) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      conv.visitorName.toLowerCase().includes(q) ||
      conv.conversationId.includes(q) ||
      conv.agentName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations..."
          className="w-full bg-bg-surface border border-border rounded px-2 py-1 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.map((conv) => (
          <button
            key={conv.conversationId}
            onClick={() => onSelect(conv.conversationId)}
            className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
              selectedId === conv.conversationId
                ? "bg-bg-surface border-l-2 border-accent"
                : "hover:bg-bg-hover"
            }`}
          >
            <div className="flex justify-between">
              <span
                className={
                  selectedId === conv.conversationId
                    ? "text-accent"
                    : "text-text-muted"
                }
              >
                {conv.visitorName || "Unknown"}
              </span>
              <span className="text-text-dim text-[10px]">
                #{conv.conversationId}
              </span>
            </div>
            <div className="text-text-dim text-[10px] mt-0.5">
              {conv.agentName} · {conv.messages.length} msgs
            </div>
            {renderBadges && (
              <div className="mt-1">{renderBadges(conv)}</div>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-text-dim text-xs p-3 text-center">
            No conversations found
          </div>
        )}
      </div>
    </div>
  );
}
