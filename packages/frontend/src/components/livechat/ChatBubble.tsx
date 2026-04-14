"use client";

import type { MessageRole } from "rag-evaluation-system/data-analysis";

export function ChatBubble({
  id,
  role,
  text,
  agentName,
  translatedText,
}: {
  id: number;
  role: MessageRole;
  text: string;
  agentName?: string;
  translatedText?: string;
}) {
  if (role === "workflow_input") {
    return (
      <div className="text-center my-1">
        <span className="text-text-dim text-[10px] bg-bg-surface px-2 py-0.5 rounded-full">
          {text}
        </span>
      </div>
    );
  }

  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`max-w-[70%] px-2.5 py-1.5 text-xs whitespace-pre-wrap ${
          isUser
            ? "bg-accent-dim text-accent-bright rounded-lg rounded-br-sm"
            : "bg-bg-surface text-text border border-border rounded-lg rounded-bl-sm"
        }`}
      >
        <div
          className={`text-[9px] mb-0.5 ${
            isUser ? "text-accent-bright/50" : "text-text-dim"
          }`}
        >
          {isUser ? "User" : agentName ?? "Agent"} · #{id}
        </div>
        {text}
        {translatedText && (
          <>
            <div className="border-t border-dashed border-current/20 my-1" />
            <div className={`text-[11px] ${isUser ? "text-white/70" : "text-[#c084fc]"}`}>
              {translatedText}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
