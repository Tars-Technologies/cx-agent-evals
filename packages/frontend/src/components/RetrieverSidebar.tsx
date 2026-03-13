"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { KBDropdown } from "@/components/KBDropdown";
import { RetrieverListItem } from "@/components/RetrieverListItem";
import { RetrieverDetailModal } from "@/components/RetrieverDetailModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RetrieverSidebarProps {
  selectedKbId: Id<"knowledgeBases"> | null;
  onKbChange: (kbId: Id<"knowledgeBases"> | null) => void;
  selectedRetrieverId: Id<"retrievers"> | null;
  onRetrieverSelect: (id: Id<"retrievers"> | null) => void;
  onNewRetriever: () => void;
  /** Playground tab multi-select mode */
  isPlaygroundMode: boolean;
  selectedRetrieverIds: Set<Id<"retrievers">>;
  onToggleRetrieverCheck: (id: Id<"retrievers">) => void;
}

interface IndexingProgress {
  totalDocs: number;
  processedDocs: number;
  failedDocs: number;
}

// ---------------------------------------------------------------------------
// RetrieverListItemWithProgress — queries indexing job for live progress
// ---------------------------------------------------------------------------

function RetrieverListItemWithProgress({
  retriever,
  ...props
}: {
  retriever: {
    _id: Id<"retrievers">;
    name: string;
    status: "configuring" | "indexing" | "ready" | "error";
    retrieverConfig: unknown;
    defaultK: number;
    chunkCount?: number;
    error?: string;
    indexingJobId?: Id<"indexingJobs">;
  };
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onStartIndexing: () => void;
  onCancelIndexing: () => void;
  onDeleteIndex: () => void;
  onDelete: () => void;
  onViewFullConfig: () => void;
  isCheckboxMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: () => void;
}) {
  const job = useQuery(
    api.retrieval.indexing.getJob,
    retriever.status === "indexing" && retriever.indexingJobId
      ? { jobId: retriever.indexingJobId }
      : "skip",
  );

  const progress: IndexingProgress | undefined = job
    ? {
        totalDocs: job.totalDocs,
        processedDocs: job.processedDocs,
        failedDocs: job.failedDocs,
      }
    : undefined;

  return (
    <RetrieverListItem
      retriever={retriever}
      progress={progress}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// RetrieverSidebar
// ---------------------------------------------------------------------------

export function RetrieverSidebar({
  selectedKbId,
  onKbChange,
  selectedRetrieverId,
  onRetrieverSelect,
  onNewRetriever,
  isPlaygroundMode,
  selectedRetrieverIds,
  onToggleRetrieverCheck,
}: RetrieverSidebarProps) {
  // --- Data fetching ---
  const retrievers = useQuery(
    api.crud.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // --- Actions & Mutations ---
  const startIndexingAction = useAction(
    api.retrieval.retrieverActions.startIndexing,
  );
  const removeRetriever = useMutation(api.crud.retrievers.remove);
  const deleteIndexMutation = useMutation(api.crud.retrievers.deleteIndex);
  const resetAfterCancelMutation = useMutation(
    api.crud.retrievers.resetAfterCancel,
  );
  const cancelIndexingMutation = useMutation(
    api.retrieval.indexing.cancelIndexing,
  );

  // --- Local UI state ---
  const [expandedId, setExpandedId] = useState<Id<"retrievers"> | null>(null);
  const [detailRetrieverId, setDetailRetrieverId] = useState<Id<"retrievers"> | null>(null);

  // --- Action handlers ---

  const handleStartIndexing = useCallback(
    async (id: Id<"retrievers">) => {
      try {
        await startIndexingAction({ retrieverId: id });
      } catch (err) {
        console.error("Failed to start indexing:", err);
      }
    },
    [startIndexingAction],
  );

  const handleCancelIndexing = useCallback(
    async (id: Id<"retrievers">, jobId?: string) => {
      try {
        if (jobId) {
          await cancelIndexingMutation({
            jobId: jobId as Id<"indexingJobs">,
          });
        }
        await resetAfterCancelMutation({ id });
      } catch (err) {
        console.error("Failed to cancel indexing:", err);
      }
    },
    [cancelIndexingMutation, resetAfterCancelMutation],
  );

  const handleDeleteIndex = useCallback(
    async (id: Id<"retrievers">) => {
      try {
        await deleteIndexMutation({ id });
      } catch (err) {
        console.error("Failed to delete index:", err);
      }
    },
    [deleteIndexMutation],
  );

  const handleDelete = useCallback(
    async (id: Id<"retrievers">) => {
      try {
        await removeRetriever({ id });
        // Clear selection if the deleted retriever was selected
        if (selectedRetrieverId === id) {
          onRetrieverSelect(null);
        }
        if (expandedId === id) {
          setExpandedId(null);
        }
      } catch (err) {
        console.error("Failed to delete retriever:", err);
      }
    },
    [removeRetriever, selectedRetrieverId, onRetrieverSelect, expandedId],
  );

  const handleSelect = useCallback(
    (id: Id<"retrievers">) => {
      onRetrieverSelect(id);
      setExpandedId((prev) => (prev === id ? null : id));
    },
    [onRetrieverSelect],
  );

  const handleToggleExpand = useCallback((id: Id<"retrievers">) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // --- Render ---

  return (
    <div className="w-[320px] flex-shrink-0 border-r border-border bg-bg-elevated flex flex-col h-full overflow-hidden">
      {/* KB Selector + New Retriever button */}
      <div className="p-3 border-b border-border space-y-3">
        <KBDropdown selectedKbId={selectedKbId} onSelect={onKbChange} />
        <button
          onClick={onNewRetriever}
          disabled={!selectedKbId}
          className="w-full py-2 rounded-lg text-xs font-medium bg-accent hover:bg-accent/90 text-bg-elevated disabled:bg-border disabled:text-text-dim disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          + New Retriever
        </button>
      </div>

      {/* Scrollable retriever list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {!selectedKbId ? (
          <p className="text-text-dim text-xs p-2">
            Select a knowledge base to see retrievers.
          </p>
        ) : retrievers === undefined ? (
          <div className="flex items-center gap-2 text-text-dim text-xs p-2">
            <div className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Loading...
          </div>
        ) : retrievers.length === 0 ? (
          <p className="text-text-dim text-xs p-2">
            No retrievers yet. Click &quot;+ New Retriever&quot; to create one.
          </p>
        ) : (
          retrievers.map((r) => (
            <RetrieverListItemWithProgress
              key={r._id}
              retriever={{
                _id: r._id,
                name: r.name,
                status: r.status,
                retrieverConfig: r.retrieverConfig,
                defaultK: r.defaultK,
                chunkCount: r.chunkCount,
                error: r.error,
                indexingJobId: r.indexingJobId,
              }}
              isSelected={selectedRetrieverId === r._id}
              isExpanded={expandedId === r._id}
              onSelect={() => handleSelect(r._id)}
              onToggleExpand={() => handleToggleExpand(r._id)}
              onStartIndexing={() => handleStartIndexing(r._id)}
              onCancelIndexing={() =>
                handleCancelIndexing(
                  r._id,
                  r.indexingJobId as string | undefined,
                )
              }
              onDeleteIndex={() => handleDeleteIndex(r._id)}
              onDelete={() => handleDelete(r._id)}
              onViewFullConfig={() => setDetailRetrieverId(r._id)}
              isCheckboxMode={isPlaygroundMode}
              isChecked={selectedRetrieverIds.has(r._id)}
              onToggleCheck={() => onToggleRetrieverCheck(r._id)}
            />
          ))
        )}
      </div>

      {/* Detail modal */}
      {detailRetrieverId && (() => {
        const r = retrievers?.find((ret) => ret._id === detailRetrieverId);
        if (!r) return null;
        const sharingRetrievers = (retrievers ?? [])
          .filter(
            (other) =>
              other._id !== r._id &&
              other.indexConfigHash === r.indexConfigHash,
          )
          .map((other) => ({ name: other.name }));
        return (
          <RetrieverDetailModal
            retriever={{
              name: r.name,
              retrieverConfig: r.retrieverConfig,
              defaultK: r.defaultK,
              status: r.status,
              chunkCount: r.chunkCount,
              createdAt: r._creationTime,
            }}
            sharingRetrievers={sharingRetrievers}
            onDeleteIndex={async () => {
              await handleDeleteIndex(r._id);
              setDetailRetrieverId(null);
            }}
            onDeleteRetriever={async () => {
              await handleDelete(r._id);
              setDetailRetrieverId(null);
            }}
            onClose={() => setDetailRetrieverId(null)}
          />
        );
      })()}
    </div>
  );
}
