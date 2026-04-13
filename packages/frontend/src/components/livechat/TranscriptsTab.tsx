"use client";

import { useState, useMemo } from "react";
import type { RawTranscriptsFile, RawConversation } from "rag-evaluation-system/data-analysis";
import { ResizablePanel } from "../ResizablePanel";
import { ConversationList } from "./ConversationList";
import { ChatBubble } from "./ChatBubble";

export function TranscriptsTab({
  data,
}: {
  data: RawTranscriptsFile | null;
}) {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const conversations = useMemo(() => {
    if (!data) return [];
    return data.conversations.filter(
      (c) => c.metadata.messageCountVisitor > 0
    );
  }, [data]);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.conversationId === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view transcripts
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation list */}
      <ResizablePanel storageKey="livechat-transcripts-convos" defaultWidth={220} className="border-r border-border">
        <ConversationList
          conversations={conversations}
          selectedId={selectedConvId}
          onSelect={setSelectedConvId}
        />
      </ResizablePanel>

      {/* Chat detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedConv ? (
          <>
            <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
              <div>
                <span className="text-text text-xs font-semibold">
                  {selectedConv.visitorName || "Unknown"}
                </span>
                <span className="text-text-dim text-[10px] ml-2">
                  #{selectedConv.conversationId} · {selectedConv.visitorPhone}
                </span>
              </div>
              <div className="flex gap-1">
                {selectedConv.status && (
                  <span className="text-[9px] text-text-muted bg-bg-surface border border-border rounded px-1.5 py-0.5">
                    {selectedConv.status}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {selectedConv.messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  text={msg.text}
                  agentName={selectedConv.agentName}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            Select a conversation to view
          </div>
        )}
      </div>
    </div>
  );
}
