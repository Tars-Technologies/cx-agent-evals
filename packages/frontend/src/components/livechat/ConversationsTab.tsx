"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ResizablePanel } from "../ResizablePanel";
import { ConversationList } from "./ConversationList";
import { MessageTypeCard } from "./MessageTypeCard";
import { MessageTypeFeed } from "./MessageTypeFeed";
import { ChatBubble } from "./ChatBubble";
import { ExportButton } from "./ExportButton";
import type { MessageTypeCategory, MessageTypeItem, MessagesByType } from "./types";

/** Check if text contains non-Latin script characters that likely need translation. */
function needsTranslation(text: string): boolean {
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text);
}

const TYPE_ORDER: MessageTypeCategory[] = [
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

export function ConversationsTab({ uploadId }: { uploadId: Id<"livechatUploads"> }) {
  // --- State ---
  const [view, setView] = useState<"conversation" | "messageType">("conversation");
  const [selectedConvId, setSelectedConvId] = useState<Id<"livechatConversations"> | null>(null);
  const [selectedType, setSelectedType] = useState<MessageTypeCategory>("question");
  const [allExpanded, setAllExpanded] = useState(true);
  const [showMessageTypes, setShowMessageTypes] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Optimistic UI: track pending operations so buttons react immediately
  const [templateId, setTemplateId] = useState("cx-transcript-analysis");
  const [pendingClassify, setPendingClassify] = useState<Set<string>>(new Set());
  const [pendingTranslate, setPendingTranslate] = useState<Set<string>>(new Set());
  // Batch progress tracking: remembers which IDs were submitted and what operation
  const [batchOp, setBatchOp] = useState<{
    type: "classify" | "translate";
    ids: Set<string>;
  } | null>(null);

  // --- Queries ---
  const { results, status, loadMore } = usePaginatedQuery(
    api.livechat.orchestration.listConversations,
    { uploadId },
    { initialNumItems: 200 },
  );

  const selectedConv = useQuery(
    api.livechat.orchestration.getConversation,
    selectedConvId ? { id: selectedConvId } : "skip",
  );

  const counts = useQuery(api.livechat.orchestration.getClassificationCounts, { uploadId });

  // --- Mutations ---
  const classifySingle = useMutation(api.livechat.orchestration.classifySingle);
  const translateSingle = useMutation(api.livechat.orchestration.translateSingle);
  const classifyBatch = useMutation(api.livechat.orchestration.classifyBatch);
  const translateBatch = useMutation(api.livechat.orchestration.translateBatch);

  // --- Derived data ---
  const allConversations = useMemo(() => results ?? [], [results]);

  const maxSelected = selectedIds.size >= 100;

  // Effective statuses (merge server state with optimistic pending state)
  const effectiveClassificationStatus = selectedConvId && pendingClassify.has(selectedConvId)
    ? "running"
    : selectedConv?.classificationStatus;
  const effectiveTranslationStatus = selectedConvId && pendingTranslate.has(selectedConvId)
    ? "running"
    : selectedConv?.translationStatus;

  // Clear optimistic state when server state catches up
  useEffect(() => {
    if (!selectedConvId || !selectedConv) return;
    if (
      selectedConv.classificationStatus === "running" ||
      selectedConv.classificationStatus === "done"
    ) {
      setPendingClassify((prev) => {
        if (!prev.has(selectedConvId)) return prev;
        const next = new Set(prev);
        next.delete(selectedConvId);
        return next;
      });
    }
    if (
      selectedConv.translationStatus === "running" ||
      selectedConv.translationStatus === "done"
    ) {
      setPendingTranslate((prev) => {
        if (!prev.has(selectedConvId)) return prev;
        const next = new Set(prev);
        next.delete(selectedConvId);
        return next;
      });
    }
  }, [selectedConvId, selectedConv?.classificationStatus, selectedConv?.translationStatus]);

  // Batch progress: count how many are done vs total
  const batchProgress = useMemo(() => {
    if (!batchOp) return null;
    const total = batchOp.ids.size;
    const statusField = batchOp.type === "classify" ? "classificationStatus" : "translationStatus";
    let done = 0;
    for (const conv of allConversations) {
      if (!batchOp.ids.has(conv._id)) continue;
      if (conv[statusField] === "done" || conv[statusField] === "failed") done++;
    }
    return { total, done, type: batchOp.type };
  }, [batchOp, allConversations]);

  // Auto-clear batch op when all done
  useEffect(() => {
    if (batchProgress && batchProgress.done >= batchProgress.total) {
      const timer = setTimeout(() => setBatchOp(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [batchProgress]);

  // Check if conversation has any messages needing translation
  const hasTranslatableMessages = useMemo(() => {
    if (!selectedConv) return false;
    return selectedConv.messages.some((m: { text: string }) => needsTranslation(m.text));
  }, [selectedConv]);

  // Build MessagesByType for the "By Message Type" view
  const messagesByType = useMemo(() => {
    const map: MessagesByType = new Map();
    for (const conv of allConversations) {
      if (conv.classificationStatus !== "done" || !conv.messageTypes) continue;
      for (const mt of conv.messageTypes as any[]) {
        const items = map.get(mt.type as MessageTypeCategory) || [];
        items.push({
          conversationId: conv.conversationId,
          visitorName: conv.visitorName,
          agentName: conv.agentName,
          language: (conv as any).botFlowInput?.language || "unknown",
          messageType: mt,
        });
        map.set(mt.type as MessageTypeCategory, items);
      }
    }
    return map;
  }, [allConversations]);

  // Total classified count from the messagesByType map
  const classifiedCount = counts?.classified ?? 0;

  // --- Handlers ---
  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 100) {
        next.add(id);
      }
      return next;
    });
  }

  function handleSelectNext10Unclassified() {
    const remaining = 100 - selectedIds.size;
    if (remaining <= 0) return;
    const unclassified = allConversations.filter(
      (c) => c.classificationStatus === "none" && !selectedIds.has(c._id),
    );
    const toAdd = unclassified.slice(0, Math.min(10, remaining));
    if (toAdd.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of toAdd) next.add(c._id);
      return next;
    });
  }

  function handleBatchClassify() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds) as Id<"livechatConversations">[];
    setBatchOp({ type: "classify", ids: new Set(selectedIds) });
    setSelectionMode(false);
    setSelectedIds(new Set());
    classifyBatch({ uploadId, conversationIds: ids, templateId });
  }

  function handleBatchTranslate() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds) as Id<"livechatConversations">[];
    setBatchOp({ type: "translate", ids: new Set(selectedIds) });
    setSelectionMode(false);
    setSelectedIds(new Set());
    translateBatch({ uploadId, conversationIds: ids });
  }

  function handleToggleSelectionMode() {
    if (selectionMode) {
      setSelectedIds(new Set());
    }
    setSelectionMode(!selectionMode);
  }

  // --- Render ---
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header row */}
      <div className="bg-bg-elevated px-3 py-1.5 border-b border-border flex justify-between items-center">
        <div className="flex bg-bg-surface rounded border border-border overflow-hidden">
          <button
            onClick={() => setView("conversation")}
            className={`px-3 py-1 text-[10px] ${
              view === "conversation"
                ? "bg-accent-dim text-accent-bright"
                : "text-text-dim hover:text-text"
            }`}
          >
            By Conversation ({counts?.total ?? "..."})
          </button>
          <button
            onClick={() => setView("messageType")}
            className={`px-3 py-1 text-[10px] ${
              view === "messageType"
                ? "bg-accent-dim text-accent-bright"
                : "text-text-dim hover:text-text"
            }`}
          >
            By Message Type ({classifiedCount} classified)
          </button>
        </div>
        {view === "conversation" && (
          <div className="flex items-center gap-2">
            {/* Batch progress indicator */}
            {batchProgress && (
              <div className="flex items-center gap-1.5">
                <span className="animate-spin text-[10px]">&#x27F3;</span>
                <span className="text-[10px] text-text-muted">
                  {batchProgress.type === "classify" ? "Classifying" : "Translating"}{" "}
                  {batchProgress.done}/{batchProgress.total}
                </span>
                <div className="w-16 h-1 bg-bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      batchProgress.type === "classify" ? "bg-accent" : "bg-[#c084fc]"
                    }`}
                    style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="bg-bg-surface border border-border rounded px-2 py-0.5 text-[10px] text-text"
            >
              <option value="cx-transcript-analysis">CX Transcript Analysis</option>
              <option value="eval-dataset-extraction">Eval Dataset Extraction</option>
            </select>
            <button
              onClick={handleToggleSelectionMode}
              className="text-[10px] text-text-muted hover:text-accent border border-border rounded px-2 py-0.5 transition-colors"
            >
              {selectionMode ? "Done Selecting" : "Select Conversations"}
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      {view === "conversation" ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <ResizablePanel
            storageKey="livechat-conversations-sidebar"
            defaultWidth={240}
            className="border-r border-border flex flex-col"
          >
            <div className="flex flex-col h-full">
              {/* Selection mode header */}
              {selectionMode && (
                <div className="px-2 py-1.5 border-b border-border">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-text-muted text-[10px]">
                      {selectedIds.size}/100 selected
                    </span>
                  </div>
                  <button
                    onClick={handleSelectNext10Unclassified}
                    disabled={maxSelected}
                    className={`w-full text-[10px] border border-border rounded px-2 py-0.5 transition-colors ${
                      maxSelected
                        ? "opacity-50 cursor-not-allowed text-text-dim"
                        : "text-text-muted hover:text-accent hover:border-accent/40"
                    }`}
                  >
                    Select next 10 unclassified
                  </button>
                </div>
              )}

              {/* Conversation list */}
              <div className="flex-1 overflow-hidden">
                <ConversationList
                  conversations={allConversations as any[]}
                  selectedId={selectedConvId}
                  onSelect={(id) => setSelectedConvId(id as Id<"livechatConversations">)}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                  maxSelected={maxSelected}
                  showStatusDots
                />
              </div>

              {/* Load more button */}
              {status !== "Exhausted" && (
                <div className="p-2 border-t border-border">
                  <button
                    onClick={() => loadMore(200)}
                    className="w-full text-[10px] text-text-muted hover:text-accent border border-border rounded px-2 py-1 transition-colors"
                  >
                    {status === "LoadingMore" ? (
                      <span className="animate-spin inline-block mr-1">&#x27F3;</span>
                    ) : null}
                    Load more
                  </button>
                </div>
              )}

              {/* Floating action bar for batch operations */}
              {selectionMode && selectedIds.size > 0 && (
                <div className="p-2 border-t border-border bg-bg-elevated flex gap-1.5">
                  <button
                    onClick={handleBatchClassify}
                    className="flex-1 bg-accent text-bg font-medium px-3 py-1.5 rounded text-xs hover:opacity-90"
                  >
                    Classify ({selectedIds.size})
                  </button>
                  <button
                    onClick={handleBatchTranslate}
                    className="flex-1 bg-[#c084fc] text-bg font-medium px-3 py-1.5 rounded text-xs hover:opacity-90"
                  >
                    Translate ({selectedIds.size})
                  </button>
                </div>
              )}
            </div>
          </ResizablePanel>

          {/* Detail pane */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedConv ? (
              <>
                {/* Detail header */}
                <div className="bg-bg-elevated px-3 py-2 border-b border-border">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-text text-xs font-semibold">
                        {selectedConv.visitorName || "Unknown"}
                      </span>
                      <span className="text-text-dim text-[10px] ml-2">
                        #{selectedConv.conversationId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* Classification controls */}
                      {(effectiveClassificationStatus === "none" ||
                        effectiveClassificationStatus === "failed") && (
                        <button
                          onClick={() => {
                            setPendingClassify((prev) => new Set(prev).add(selectedConvId!));
                            classifySingle({ conversationId: selectedConvId!, templateId });
                          }}
                          className="bg-accent text-bg font-medium px-3 py-1 rounded text-[10px] hover:opacity-90"
                        >
                          Classify
                        </button>
                      )}
                      {effectiveClassificationStatus === "running" && (
                        <span className="text-text-muted text-[10px] flex items-center gap-1">
                          <span className="animate-spin">&#x27F3;</span>
                          Classifying...
                        </span>
                      )}
                      {effectiveClassificationStatus === "done" && (
                        <button
                          onClick={() => setShowMessageTypes(!showMessageTypes)}
                          className={`text-[10px] border rounded px-2 py-0.5 transition-colors ${
                            showMessageTypes
                              ? "border-accent text-accent"
                              : "border-border text-text-dim hover:text-text"
                          }`}
                        >
                          {showMessageTypes ? "Hide" : "Show"} Message Types
                        </button>
                      )}

                      {/* Translation controls — only show if conversation has translatable messages */}
                      {hasTranslatableMessages && (effectiveTranslationStatus === "none" ||
                        effectiveTranslationStatus === "failed") && (
                        <button
                          onClick={() => {
                            setPendingTranslate((prev) => new Set(prev).add(selectedConvId!));
                            translateSingle({ conversationId: selectedConvId! });
                          }}
                          className="bg-[#c084fc] text-bg font-medium px-3 py-1 rounded text-[10px] hover:opacity-90"
                        >
                          Translate
                        </button>
                      )}
                      {effectiveTranslationStatus === "running" && (
                        <span className="text-text-muted text-[10px] flex items-center gap-1">
                          <span className="animate-spin">&#x27F3;</span>
                          Translating...
                        </span>
                      )}

                      {/* Expand/Collapse toggle */}
                      {showMessageTypes &&
                        selectedConv.classificationStatus === "done" && (
                          <button
                            onClick={() => setAllExpanded(!allExpanded)}
                            className="px-2 py-1 text-[10px] text-text-dim border border-border rounded hover:text-text hover:border-accent/40 transition-colors"
                          >
                            {allExpanded ? "Collapse All" : "Expand All"}
                          </button>
                        )}

                      {/* Export */}
                      <ExportButton
                        data={selectedConv}
                        filename={`conversation-${selectedConv.conversationId}.json`}
                      />
                    </div>
                  </div>
                </div>

                {/* Message content */}
                <div className="flex-1 overflow-y-auto p-3">
                  {/* Bot flow input badge */}
                  {(selectedConv as any).botFlowInput && (
                    <div className="text-center mb-2">
                      <span className="text-[#fbbf24] text-[10px] bg-[#fbbf2415] px-2 py-0.5 rounded-full border border-[#fbbf2430]">
                        {(selectedConv as any).botFlowInput.intent} ·{" "}
                        {(selectedConv as any).botFlowInput.language}
                      </span>
                    </div>
                  )}

                  {showMessageTypes &&
                  selectedConv.classificationStatus === "done" &&
                  (selectedConv.messageTypes || (selectedConv as any).blocks) ? (
                    /* Accordion cards view */
                    (selectedConv as any).blocks ? (
                      ((selectedConv as any).blocks as any[]).map((block: any, i: number) => (
                        <MessageTypeCard
                          key={i}
                          block={block}
                          classifiedMessages={(selectedConv as any).classifiedMessages}
                          messages={selectedConv.messages}
                          conversationId={selectedConvId!}
                          agentName={selectedConv.agentName}
                          forceExpanded={allExpanded}
                          translatedMessages={(selectedConv as any).translatedMessages}
                        />
                      ))
                    ) : (
                      (selectedConv.messageTypes as any[]).map(
                        (mt: any, i: number) => (
                          <MessageTypeCard
                            key={i}
                            messageType={mt}
                            agentName={selectedConv.agentName}
                            forceExpanded={allExpanded}
                            translatedMessages={(selectedConv as any).translatedMessages}
                          />
                        ),
                      )
                    )
                  ) : (
                    /* Flat chat bubble view */
                    selectedConv.messages.map(
                      (msg: { id: number; role: string; text: string }) => {
                        const translation = (
                          selectedConv as any
                        )?.translatedMessages?.find(
                          (t: { id: number }) => t.id === msg.id,
                        );
                        return (
                          <ChatBubble
                            key={msg.id}
                            id={msg.id}
                            role={msg.role as any}
                            text={msg.text}
                            agentName={selectedConv.agentName}
                            translatedText={translation?.text}
                          />
                        );
                      },
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-text-dim text-xs">
                Select a conversation to view
              </div>
            )}
          </div>
        </div>
      ) : (
        /* By Message Type view */
        <div className="flex flex-1 overflow-hidden">
          {/* Type list sidebar */}
          <ResizablePanel
            storageKey="livechat-messagetype-sidebar"
            defaultWidth={180}
            className="border-r border-border"
          >
            <div className="flex-1 overflow-y-auto p-1">
              {TYPE_ORDER.map((type) => {
                const items = messagesByType.get(type) ?? [];
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
          </ResizablePanel>

          {/* Feed */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
              <div>
                <span className="text-accent text-xs font-semibold">
                  {(messagesByType.get(selectedType) ?? []).length} {selectedType}s
                </span>
                <span className="text-text-dim text-[10px] ml-2">
                  across {classifiedCount} classified conversations
                </span>
              </div>
              <ExportButton
                data={{
                  type: selectedType,
                  exportedAt: new Date().toISOString(),
                  totalItems: (messagesByType.get(selectedType) ?? []).length,
                  items: (messagesByType.get(selectedType) ?? []).map((item) => ({
                    conversationId: item.conversationId,
                    visitorName: item.visitorName,
                    agentName: item.agentName,
                    language: item.language,
                    exchanges: item.messageType.exchanges,
                    extracted: item.messageType.extracted,
                  })),
                }}
                filename={`${selectedType}-export.json`}
              />
            </div>
            <MessageTypeFeed items={messagesByType.get(selectedType) ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
