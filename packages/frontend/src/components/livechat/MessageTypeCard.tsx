"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import type { MessageType, MessageRole } from "rag-evaluation-system/data-analysis";
import { ChatBubble } from "./ChatBubble";
import { LabelEditDropdown } from "./LabelEditDropdown";
import type { ConversationBlock, ClassifiedMessage } from "./types";

const TYPE_COLORS: Record<string, { badge: string; border: string }> = {
  question: { badge: "bg-accent-dim text-accent-bright", border: "border-accent" },
  request: { badge: "bg-[#818cf820] text-[#818cf8]", border: "border-[#818cf8]" },
  identity_info: { badge: "bg-[#fbbf2420] text-[#fbbf24]", border: "border-[#fbbf24]" },
  greeting: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  closing: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  confirmation: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  uncategorized: { badge: "bg-bg-surface text-text-dim", border: "border-border" },
  response: { badge: "bg-[#4488aa20] text-[#4488aa]", border: "border-[#4488aa]" },
  proactive: { badge: "bg-[#ff888820] text-[#ff8888]", border: "border-[#ff8888]" },
  procedural: { badge: "bg-[#88888820] text-text-dim", border: "border-border" },
  other: { badge: "bg-bg-surface text-text-dim", border: "border-border" },
};

// Label categories available for editing (user categories)
const USER_CATEGORIES = ["question", "request", "identity_info", "confirmation", "greeting", "closing", "uncategorized", "other"];

interface MessageTypeCardProps {
  // Old format (backward compat)
  messageType?: MessageType;
  // New format
  block?: ConversationBlock;
  classifiedMessages?: ClassifiedMessage[];
  messages?: Array<{ id: number; role: string; text: string }>;
  conversationId?: Id<"livechatConversations">;
  // Common
  agentName?: string;
  forceExpanded?: boolean;
  translatedMessages?: Array<{ id: number; text: string }>;
}

export function MessageTypeCard({
  messageType,
  block,
  classifiedMessages,
  messages,
  conversationId,
  agentName,
  forceExpanded,
  translatedMessages,
}: MessageTypeCardProps) {
  const [localExpanded, setLocalExpanded] = useState(forceExpanded ?? false);
  const expanded = forceExpanded ?? localExpanded;
  const patchLabel = useMutation(api.livechat.orchestration.patchMessageLabel);

  // ── Old format rendering ──
  if (messageType && !block) {
    const colors = TYPE_COLORS[messageType.type] ?? TYPE_COLORS.uncategorized;
    const msgCount = messageType.exchanges.reduce((s, e) => s + e.messages.length, 0);

    if (
      messageType.type === "uncategorized" &&
      messageType.exchanges.every((e) => e.messages.every((m) => m.role === "workflow_input"))
    ) {
      const text = messageType.exchanges.flatMap((e) => e.messages).map((m) => m.text).join(" · ");
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
          messageType.exchanges[0]?.messages[0]?.text ?? "";

    return (
      <div className={`bg-bg-surface rounded-md border ${expanded ? colors.border : "border-border"} mb-1`}>
        <button onClick={() => setLocalExpanded(!expanded)} className="w-full text-left px-2.5 py-1.5 flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-text-dim">{expanded ? "▾" : "▸"}</span>
            <span className={`text-[9px] px-1.5 py-0 rounded ${colors.badge}`}>{messageType.type}</span>
            {!expanded && <span className="text-text-muted text-xs truncate">{previewText}</span>}
          </div>
          <span className="text-text-dim text-[10px] ml-2 whitespace-nowrap">{msgCount} msgs</span>
        </button>
        {expanded && (
          <div className="border-t border-border">
            {messageType.exchanges.map((exchange, i) => (
              <div key={i} className={i > 0 ? "border-t border-border/50" : ""}>
                <div className="px-2.5 pt-1.5 pb-0.5">
                  <div className="text-text-dim text-[9px] uppercase tracking-wider mb-1">{exchange.label}</div>
                </div>
                <div className="px-2.5 pb-2">
                  {exchange.messages.map((msg) => {
                    const translation = translatedMessages?.find((t) => t.id === msg.id);
                    return <ChatBubble key={msg.id} id={msg.id} role={msg.role} text={msg.text} agentName={agentName} translatedText={translation?.text} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── New block format rendering ──
  if (!block || !messages) return null;

  const colors = TYPE_COLORS[block.label] ?? TYPE_COLORS.uncategorized;
  const blockMessages = messages.filter((m) => block.messageIds.includes(m.id));
  const firstUserMsg = blockMessages.find((m) => m.role === "user");
  const previewText = block.standaloneVersion ?? firstUserMsg?.text ?? blockMessages[0]?.text ?? "";

  return (
    <div className={`bg-bg-surface rounded-md border ${expanded ? colors.border : "border-border"} mb-1`}>
      <div role="button" tabIndex={0} onClick={() => setLocalExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setLocalExpanded(!expanded); }} className="w-full text-left px-2.5 py-1.5 flex justify-between items-center cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-text-dim">{expanded ? "▾" : "▸"}</span>
          {/* Label badge with edit dropdown */}
          {conversationId ? (
            <span onClick={(e) => e.stopPropagation()}>
              <LabelEditDropdown
                currentLabel={block.label}
                categories={USER_CATEGORIES}
                onSelect={(newLabel) => {
                  if (!firstUserMsg) return;
                  patchLabel({ conversationId, messageId: firstUserMsg.id, newLabel });
                }}
              />
            </span>
          ) : (
            <span className={`text-[9px] px-1.5 py-0 rounded ${colors.badge}`}>{block.label}</span>
          )}
          {/* Intent code */}
          {block.intentOpenCode && (
            <span className="text-[8px] text-text-dim bg-bg-hover px-1 py-0 rounded">{block.intentOpenCode}</span>
          )}
          {/* Confidence dot */}
          <span className={`w-1.5 h-1.5 rounded-full ${block.confidence === "high" ? "bg-[#6ee7b7]" : "bg-[#fbbf24]"}`} />
          {/* Follow-up badge */}
          {block.isFollowUp && (
            <span className="text-[8px] text-[#c084fc] bg-[#c084fc15] px-1 rounded">
              {block.followUpType ?? "follow-up"}
            </span>
          )}
          {!expanded && <span className="text-text-muted text-xs truncate">{previewText}</span>}
        </div>
        <span className="text-text-dim text-[10px] ml-2 whitespace-nowrap">{blockMessages.length} msgs</span>
      </div>

      {expanded && (
        <div className="border-t border-border px-2.5 pb-2 pt-1.5">
          {/* Standalone version (if follow-up) */}
          {block.isFollowUp && block.standaloneVersion && (
            <div className="mb-2 px-2 py-1 rounded bg-accent-dim/20 border border-accent/10">
              <div className="text-[8px] text-accent uppercase tracking-wider mb-0.5">Standalone version</div>
              <div className="text-xs text-accent-bright">{block.standaloneVersion}</div>
            </div>
          )}
          {blockMessages.map((msg) => {
            const translation = translatedMessages?.find((t) => t.id === msg.id);
            const classified = classifiedMessages?.find((cm) => cm.messageId === msg.id);
            return (
              <div key={msg.id} className="relative">
                <ChatBubble id={msg.id} role={msg.role as MessageRole} text={msg.text} agentName={agentName} translatedText={translation?.text} />
                {/* Agent role tag */}
                {msg.role === "human_agent" && classified && (
                  <span className="absolute top-0 right-0 text-[7px] text-text-dim bg-bg-hover px-1 rounded-bl">
                    {classified.label}
                  </span>
                )}
                {/* Edited indicator */}
                {classified?.source === "human" && (
                  <span className="absolute top-0 right-0 text-[7px] text-[#fbbf24]">edited</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
