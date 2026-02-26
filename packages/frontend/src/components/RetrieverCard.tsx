"use client";

import type { Id } from "@convex/_generated/dataModel";

interface IndexingProgress {
  totalDocs: number;
  processedDocs: number;
  failedDocs: number;
}

interface RetrieverCardProps {
  retriever: {
    _id: Id<"retrievers">;
    name: string;
    status: string;
    retrieverConfig: unknown;
    chunkCount?: number;
    error?: string;
    defaultK: number;
    indexConfigHash: string;
    indexingJobId?: string;
    createdAt: number;
  };
  indexingProgress?: IndexingProgress | null;
  isSelected: boolean;
  isHighlighted?: boolean;
  onToggleSelect: (id: Id<"retrievers">) => void;
  onStartIndexing: (id: Id<"retrievers">) => void;
  onCancelIndexing: (id: Id<"retrievers">, jobId?: string) => void;
  onDeleteIndex: (id: Id<"retrievers">) => void;
  onDelete: (id: Id<"retrievers">) => void;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; bg: string }> = {
  configuring: { dot: "bg-text-dim", label: "text-text-dim", bg: "border-border" },
  indexing: { dot: "bg-accent animate-pulse", label: "text-accent", bg: "border-accent/20" },
  ready: { dot: "bg-accent", label: "text-accent", bg: "border-accent/30" },
  error: { dot: "bg-red-500", label: "text-red-400", bg: "border-red-500/30" },
};

export function RetrieverCard({
  retriever,
  indexingProgress,
  isSelected,
  isHighlighted,
  onToggleSelect,
  onStartIndexing,
  onCancelIndexing,
  onDeleteIndex,
  onDelete,
}: RetrieverCardProps) {
  const style = STATUS_STYLES[retriever.status] ?? STATUS_STYLES.configuring;
  const config = retriever.retrieverConfig as { search?: { strategy?: string }; k?: number } | null;
  const searchStrategy = config?.search?.strategy ?? "dense";

  return (
    <div className={`border rounded-lg p-3 transition-all ${style.bg} ${
      isSelected ? "ring-1 ring-accent/40" : ""
    } ${isHighlighted ? "ring-2 ring-accent animate-pulse" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {retriever.status === "ready" && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(retriever._id)}
              className="w-3.5 h-3.5 rounded border-border bg-bg text-accent focus:ring-accent/50 flex-shrink-0 cursor-pointer"
            />
          )}
          <span className="text-sm text-text font-medium truncate">
            {retriever.name}
          </span>
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wide flex-shrink-0 ${style.label}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {retriever.status}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-dim">
        <span>{searchStrategy}</span>
        <span>k={retriever.defaultK}</span>
        {retriever.chunkCount != null && (
          <span>{retriever.chunkCount} chunks</span>
        )}
      </div>

      {retriever.error && (
        <div className="mt-2 text-[11px] text-red-400 truncate">
          {retriever.error}
        </div>
      )}

      {/* Lifecycle-aware action buttons */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {retriever.status === "configuring" && (
          <>
            <button
              onClick={() => onStartIndexing(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Start Indexing
            </button>
            <button
              onClick={() => onDelete(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
            >
              Delete
            </button>
          </>
        )}

        {retriever.status === "indexing" && (
          <>
            <div className="flex items-center gap-1.5 text-[11px] text-accent">
              <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              {indexingProgress && indexingProgress.totalDocs > 0 ? (
                <span>{indexingProgress.processedDocs}/{indexingProgress.totalDocs} docs</span>
              ) : (
                <span>Indexing...</span>
              )}
            </div>
            <button
              onClick={() => onCancelIndexing(retriever._id, retriever.indexingJobId)}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </>
        )}

        {retriever.status === "ready" && (
          <>
            <button
              onClick={() => onDeleteIndex(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              Delete Index
            </button>
            <button
              onClick={() => onDelete(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
            >
              Delete Retriever
            </button>
          </>
        )}

        {retriever.status === "error" && (
          <>
            <button
              onClick={() => onStartIndexing(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Retry Indexing
            </button>
            <button
              onClick={() => onDelete(retriever._id)}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
