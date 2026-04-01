"use client";

import { useState, useMemo } from "react";
import type {
  MicrotopicsFile,
  RawTranscriptsFile,
  MicrotopicType,
} from "rag-evaluation-system/data-analysis";
import type { MicrotopicByTypeItem, MicrotopicsByType } from "./types";
import { ConversationList } from "./ConversationList";
import { MicrotopicCard } from "./MicrotopicCard";
import { TopicTypeFeed } from "./TopicTypeFeed";
import { ExportButton } from "./ExportButton";

const TYPE_ORDER: MicrotopicType[] = [
  "question",
  "request",
  "identity_info",
  "confirmation",
  "greeting",
  "closing",
  "uncategorized",
];

const TYPE_COLORS: Record<string, string> = {
  question: "text-accent",
  request: "text-[#818cf8]",
  identity_info: "text-[#fbbf24]",
  confirmation: "text-text-muted",
  greeting: "text-text-muted",
  closing: "text-text-muted",
  uncategorized: "text-text-dim",
};

export function MicrotopicsTab({
  microtopicsData,
  rawData,
}: {
  microtopicsData: MicrotopicsFile | null;
  rawData: RawTranscriptsFile | null;
}) {
  const [view, setView] = useState<"conversation" | "topicType">("conversation");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<MicrotopicType>("question");

  // Build indexes
  const byType = useMemo<MicrotopicsByType>(() => {
    const map: MicrotopicsByType = new Map();
    if (!microtopicsData || !rawData) return map;

    const rawMap = new Map(
      rawData.conversations.map((c) => [c.conversationId, c])
    );

    for (const conv of microtopicsData.conversations) {
      const raw = rawMap.get(conv.conversationId);
      for (const mt of conv.microtopics) {
        const items = map.get(mt.type) ?? [];
        items.push({
          conversationId: conv.conversationId,
          visitorName: raw?.visitorName ?? "",
          agentName: raw?.agentName ?? "",
          language: conv.language,
          microtopic: mt,
        });
        map.set(mt.type, items);
      }
    }
    return map;
  }, [microtopicsData, rawData]);

  // Conversations with user messages
  const conversations = useMemo(() => {
    if (!rawData) return [];
    return rawData.conversations.filter(
      (c) => c.metadata.messageCountVisitor > 0
    );
  }, [rawData]);

  const selectedConvMicrotopics = useMemo(() => {
    if (!selectedConvId || !microtopicsData) return null;
    return microtopicsData.conversations.find(
      (c) => c.conversationId === selectedConvId
    ) ?? null;
  }, [selectedConvId, microtopicsData]);

  const selectedRawConv = useMemo(
    () => conversations.find((c) => c.conversationId === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  if (!microtopicsData || !rawData) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view microtopics
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-[220px] border-r border-border flex flex-col">
        {/* Toggle */}
        <div className="p-1.5 border-b border-border">
          <div className="flex bg-bg-surface rounded border border-border overflow-hidden">
            <button
              onClick={() => setView("conversation")}
              className={`flex-1 text-center py-1 text-[9px] ${
                view === "conversation"
                  ? "bg-accent-dim text-accent-bright"
                  : "text-text-dim"
              }`}
            >
              By Conversation
            </button>
            <button
              onClick={() => setView("topicType")}
              className={`flex-1 text-center py-1 text-[9px] ${
                view === "topicType"
                  ? "bg-accent-dim text-accent-bright"
                  : "text-text-dim"
              }`}
            >
              By Topic Type
            </button>
          </div>
        </div>

        {view === "conversation" ? (
          <ConversationList
            conversations={conversations}
            selectedId={selectedConvId}
            onSelect={setSelectedConvId}
            renderBadges={(conv) => {
              const mt = microtopicsData.conversations.find(
                (c) => c.conversationId === conv.conversationId
              );
              if (!mt) return null;
              const counts: Record<string, number> = {};
              mt.microtopics.forEach((m) => {
                if (m.type !== "uncategorized") {
                  counts[m.type] = (counts[m.type] || 0) + 1;
                }
              });
              return (
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(counts).map(([type, count]) => (
                    <span
                      key={type}
                      className="text-[8px] bg-accent-dim text-accent-bright px-1 rounded"
                    >
                      {type[0].toUpperCase()}×{count}
                    </span>
                  ))}
                </div>
              );
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-1">
            {TYPE_ORDER.map((type) => {
              const items = byType.get(type) ?? [];
              if (items.length === 0) return null;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 flex justify-between ${
                    selectedType === type
                      ? "bg-bg-surface border-l-2 border-accent"
                      : "hover:bg-bg-hover"
                  }`}
                >
                  <span className={TYPE_COLORS[type] ?? "text-text-dim"}>
                    {type}
                  </span>
                  <span className="text-text-dim">{items.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === "conversation" ? (
          selectedConvMicrotopics ? (
            <>
              <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
                <div>
                  <span className="text-text text-xs font-semibold">
                    {selectedRawConv?.visitorName || "Unknown"}
                  </span>
                  <span className="text-text-dim text-[10px] ml-2">
                    #{selectedConvId}
                  </span>
                </div>
                <ExportButton
                  data={selectedConvMicrotopics}
                  filename={`microtopics-${selectedConvId}.json`}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {selectedConvMicrotopics.botFlowInput && (
                  <div className="text-center mb-2">
                    <span className="text-[#fbbf24] text-[10px] bg-[#fbbf2415] px-2 py-0.5 rounded-full border border-[#fbbf2430]">
                      {selectedConvMicrotopics.botFlowInput.intent} ·{" "}
                      {selectedConvMicrotopics.botFlowInput.language}
                    </span>
                  </div>
                )}
                {selectedConvMicrotopics.microtopics.map((mt, i) => (
                  <MicrotopicCard
                    key={i}
                    microtopic={mt}
                    agentName={selectedRawConv?.agentName}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-dim text-xs">
              Select a conversation
            </div>
          )
        ) : (
          <>
            <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
              <div>
                <span className="text-accent text-xs font-semibold">
                  {(byType.get(selectedType) ?? []).length} {selectedType}s
                </span>
                <span className="text-text-dim text-[10px] ml-2">
                  across {microtopicsData.processedConversations} conversations
                </span>
              </div>
              <ExportButton
                data={{
                  type: selectedType,
                  exportedAt: new Date().toISOString(),
                  source: microtopicsData.source,
                  totalItems: (byType.get(selectedType) ?? []).length,
                  items: (byType.get(selectedType) ?? []).map((item) => ({
                    conversationId: item.conversationId,
                    visitorName: item.visitorName,
                    agentName: item.agentName,
                    language: item.language,
                    exchanges: item.microtopic.exchanges,
                    extracted: item.microtopic.extracted,
                  })),
                }}
                filename={`${selectedType}-export.json`}
              />
            </div>
            <TopicTypeFeed items={byType.get(selectedType) ?? []} />
          </>
        )}
      </div>
    </div>
  );
}
