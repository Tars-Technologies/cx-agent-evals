"use client";

import { useState } from "react";

interface ConversationRow {
  _id: string;
  conversationId: string;
  visitorName: string;
  agentName: string;
  messages: Array<{ id: number; role: string; text: string }>;
  classificationStatus?: string;
  translationStatus?: string;
  messageTypes?: any;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  renderBadges,
  selectionMode,
  selectedIds,
  onToggleSelect,
  maxSelected,
  showStatusDots,
}: {
  conversations: ConversationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderBadges?: (conv: ConversationRow) => React.ReactNode;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  maxSelected?: boolean;
  showStatusDots?: boolean;
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
        {filtered.map((conv) => {
          const isChecked = selectedIds?.has(conv._id) ?? false;
          const isDisabled = selectionMode && maxSelected && !isChecked;

          // Compute message type badge counts
          const typeCounts = (conv.messageTypes as any[] || []).reduce(
            (acc: Record<string, number>, mt: any) => {
              const key =
                mt.type === "question"
                  ? "Q"
                  : mt.type === "request"
                  ? "R"
                  : mt.type === "identity_info"
                  ? "ID"
                  : mt.type === "confirmation"
                  ? "C"
                  : null;
              if (key) acc[key] = (acc[key] || 0) + 1;
              return acc;
            },
            {}
          );

          return (
            <button
              key={conv._id}
              onClick={() => {
                if (selectionMode) {
                  if (!isDisabled && onToggleSelect) {
                    onToggleSelect(conv._id);
                  }
                } else {
                  onSelect(conv._id);
                }
              }}
              disabled={!!isDisabled}
              className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
                selectedId === conv._id
                  ? "bg-bg-surface border-l-2 border-accent"
                  : isDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:bg-bg-hover"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!!isDisabled}
                    onChange={() => {
                      if (!isDisabled && onToggleSelect) {
                        onToggleSelect(conv._id);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 accent-accent"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center gap-1">
                    <div className="flex items-center gap-1 min-w-0">
                      {showStatusDots && (
                        <span
                          title="Classification status"
                          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                            conv.classificationStatus === "done"
                              ? "bg-green-400"
                              : "bg-bg-hover"
                          }`}
                        />
                      )}
                      <span
                        className={`truncate ${
                          selectedId === conv._id
                            ? "text-accent"
                            : "text-text-muted"
                        }`}
                      >
                        {conv.visitorName || "Unknown"}
                      </span>
                    </div>
                    <span className="text-text-dim text-[10px] shrink-0">
                      #{conv.conversationId}
                    </span>
                  </div>
                  <div className="text-text-dim text-[10px] mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>
                      {conv.agentName} ·{" "}
                      {conv.messages.filter((m) => m.role !== "workflow_input").length} msgs
                    </span>
                    {conv.messageTypes && Object.keys(typeCounts).length > 0 && (
                      <span className="flex items-center gap-0.5">
                        {Object.entries(typeCounts).map(([key, count]) => (
                          <span
                            key={key}
                            className="px-1 rounded bg-bg-hover text-text-dim text-[9px]"
                          >
                            {key}×{count}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  {renderBadges && (
                    <div className="mt-1">{renderBadges(conv)}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-text-dim text-xs p-3 text-center">
            No conversations found
          </div>
        )}
      </div>
    </div>
  );
}
