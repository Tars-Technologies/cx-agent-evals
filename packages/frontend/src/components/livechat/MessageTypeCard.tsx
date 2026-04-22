"use client";

import { useState } from "react";
import type { MessageType } from "rag-evaluation-system/data-analysis";
import { ChatBubble } from "./ChatBubble";

const TYPE_COLORS: Record<string, { badge: string; border: string }> = {
  question: { badge: "bg-accent-dim text-accent-bright", border: "border-accent" },
  request: { badge: "bg-[#818cf820] text-[#818cf8]", border: "border-[#818cf8]" },
  identity_info: { badge: "bg-[#fbbf2420] text-[#fbbf24]", border: "border-[#fbbf24]" },
  greeting: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  closing: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  confirmation: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  uncategorized: { badge: "bg-bg-surface text-text-dim", border: "border-border" },
};

export function MessageTypeCard({
  messageType,
  agentName,
  forceExpanded,
  translatedMessages,
}: {
  messageType: MessageType;
  agentName?: string;
  forceExpanded?: boolean;
  translatedMessages?: Array<{ id: number; text: string }>;
}) {
  const [localExpanded, setLocalExpanded] = useState(forceExpanded ?? false);
  const expanded = forceExpanded ?? localExpanded;
  const colors = TYPE_COLORS[messageType.type] ?? TYPE_COLORS.uncategorized;
  const msgCount = messageType.exchanges.reduce(
    (s, e) => s + e.messages.length,
    0
  );

  // For uncategorized workflow messages, show compact inline
  if (
    messageType.type === "uncategorized" &&
    messageType.exchanges.every((e) =>
      e.messages.every((m) => m.role === "workflow_input")
    )
  ) {
    const text = messageType.exchanges
      .flatMap((e) => e.messages)
      .map((m) => m.text)
      .join(" · ");
    return (
      <div className="text-center my-1">
        <span className="text-text-dim text-[9px]">{text}</span>
      </div>
    );
  }

  const previewText =
    messageType.type === "identity_info" && messageType.extracted?.length
      ? messageType.extracted.map((e) => `${e.type}: ${e.value}`).join(" · ")
      : messageType.exchanges[0]?.messages.find((m) => m.role === "user")?.text ??
        messageType.exchanges[0]?.messages[0]?.text ??
        "";

  return (
    <div
      className={`bg-bg-surface rounded-md border ${
        expanded ? colors.border : "border-border"
      } mb-1`}
    >
      <button
        onClick={() => setLocalExpanded(!expanded)}
        className="w-full text-left px-2.5 py-1.5 flex justify-between items-center"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-text-dim">{expanded ? "▾" : "▸"}</span>
          <span
            className={`text-[9px] px-1.5 py-0 rounded ${colors.badge}`}
          >
            {messageType.type}
          </span>
          {!expanded && (
            <span className="text-text-muted text-xs truncate">
              {previewText}
            </span>
          )}
        </div>
        <span className="text-text-dim text-[10px] ml-2 whitespace-nowrap">
          {msgCount} msgs · {messageType.exchanges.length} ex
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {messageType.exchanges.map((exchange, i) => (
            <div
              key={i}
              className={
                i > 0 ? "border-t border-border/50" : ""
              }
            >
              <div className="px-2.5 pt-1.5 pb-0.5">
                <div className="text-text-dim text-[9px] uppercase tracking-wider mb-1">
                  {exchange.label}
                </div>
              </div>
              <div className="px-2.5 pb-2">
                {exchange.messages.map((msg) => {
                  const translation = translatedMessages?.find(
                    (t) => t.id === msg.id,
                  );
                  return (
                    <ChatBubble
                      key={msg.id}
                      id={msg.id}
                      role={msg.role}
                      text={msg.text}
                      agentName={agentName}
                      translatedText={translation?.text}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {messageType.extracted && messageType.extracted.length > 0 && (
            <div className="px-2.5 py-1.5 border-t border-border/50 flex gap-1 flex-wrap">
              {messageType.extracted.map((info, i) => (
                <span
                  key={i}
                  className="text-[9px] bg-bg-hover text-text-muted rounded px-1.5 py-0.5"
                >
                  {info.type}: {info.value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
