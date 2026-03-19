"use client";

import type { Id } from "@convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexingProgress {
  totalDocs: number;
  processedDocs: number;
  failedDocs: number;
}

interface RetrieverListItemProps {
  retriever: {
    _id: Id<"retrievers">;
    name: string;
    status: "configuring" | "indexing" | "ready" | "error";
    retrieverConfig: unknown;
    defaultK: number;
    chunkCount?: number;
    error?: string;
  };
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onStartIndexing: () => void;
  onCancelIndexing: () => void;
  onViewFullConfig: () => void;
  /** For playground multi-select mode */
  isCheckboxMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: () => void;
  /** Indexing progress (fetched externally) */
  progress?: IndexingProgress;
}

// ---------------------------------------------------------------------------
// Status styles (shared with RetrieverCard)
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  configuring: { dot: "bg-text-dim", label: "text-text-dim" },
  indexing: { dot: "bg-accent animate-pulse", label: "text-accent" },
  ready: { dot: "bg-accent", label: "text-accent" },
  error: { dot: "bg-red-500", label: "text-red-400" },
};

// ---------------------------------------------------------------------------
// Config summary formatting helpers
// ---------------------------------------------------------------------------

interface ParsedConfig {
  index: string;
  query: string;
  search: string;
  refine: string;
}

function parseRetrieverConfig(raw: unknown, defaultK: number): ParsedConfig {
  const config = raw as Record<string, unknown> | null;
  if (!config) {
    return {
      index: "unknown",
      query: "identity",
      search: `dense · k=${defaultK}`,
      refine: "none",
    };
  }

  const index = config.index as Record<string, unknown> | undefined;
  const query = config.query as Record<string, unknown> | undefined;
  const search = config.search as Record<string, unknown> | undefined;
  const refinement = config.refinement as
    | ReadonlyArray<Record<string, unknown>>
    | undefined;
  const k = (config.k as number | undefined) ?? defaultK;

  // Index line: recursive(chunkSize/chunkOverlap) · embedModel · convex
  const chunkSize = (index?.chunkSize as number | undefined) ?? 1000;
  const chunkOverlap = (index?.chunkOverlap as number | undefined) ?? 200;
  const embeddingModel =
    ((index?.embeddingModel as string | undefined) ?? "text-embedding-3-small")
      .replace("text-embedding-", "");
  const indexLine = `recursive(${chunkSize}/${chunkOverlap}) · ${embeddingModel} · convex`;

  // Query line
  const queryStrategy = (query?.strategy as string | undefined) ?? "identity";

  // Search line
  const searchStrategy = (search?.strategy as string | undefined) ?? "dense";
  let searchLine: string;
  if (searchStrategy === "hybrid") {
    const dw = (search?.denseWeight as number | undefined) ?? 0.7;
    const sw = (search?.sparseWeight as number | undefined) ?? 0.3;
    searchLine = `hybrid(${dw}/${sw}) · k=${k}`;
  } else {
    searchLine = `${searchStrategy} · k=${k}`;
  }

  // Refine line
  const refineLine =
    refinement && refinement.length > 0
      ? refinement.map((s) => s.type as string).join(" \u2192 ")
      : "none";

  return {
    index: indexLine,
    query: queryStrategy,
    search: searchLine,
    refine: refineLine,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: IndexingProgress }) {
  const percent =
    progress.totalDocs > 0
      ? Math.round((progress.processedDocs / progress.totalDocs) * 100)
      : 0;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-text-dim mb-1">
        <span>
          {progress.processedDocs}/{progress.totalDocs} docs
        </span>
        {progress.failedDocs > 0 && (
          <span className="text-red-400">{progress.failedDocs} failed</span>
        )}
      </div>
      <div className="h-1 bg-accent/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ActionButtons({
  status,
  progress,
  onStartIndexing,
  onCancelIndexing,
}: {
  status: string;
  progress?: IndexingProgress;
  onStartIndexing: () => void;
  onCancelIndexing: () => void;
}) {
  const primaryBtn =
    "text-[11px] px-2 py-1 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer";
  const dangerBtn =
    "text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer";

  return (
    <div className="mt-2 flex gap-2 flex-wrap">
      {status === "configuring" && (
        <button onClick={onStartIndexing} className={primaryBtn}>
          Start Indexing
        </button>
      )}

      {status === "indexing" && (
        <>
          <div className="flex items-center gap-1.5 text-[11px] text-accent">
            <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            {progress && progress.totalDocs > 0 ? (
              <span>
                {progress.processedDocs}/{progress.totalDocs} docs
              </span>
            ) : (
              <span>Indexing...</span>
            )}
          </div>
          <button onClick={onCancelIndexing} className={dangerBtn}>
            Cancel
          </button>
        </>
      )}

      {status === "error" && (
        <button onClick={onStartIndexing} className={primaryBtn}>
          Retry Indexing
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RetrieverListItem({
  retriever,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onStartIndexing,
  onCancelIndexing,
  onViewFullConfig,
  isCheckboxMode,
  isChecked,
  onToggleCheck,
  progress,
}: RetrieverListItemProps) {
  const style = STATUS_STYLES[retriever.status] ?? STATUS_STYLES.configuring;

  const handleHeaderClick = () => {
    onSelect();
  };

  const summary = isExpanded
    ? parseRetrieverConfig(retriever.retrieverConfig, retriever.defaultK)
    : null;

  return (
    <div
      className={`bg-bg-elevated hover:bg-bg-surface transition-colors rounded-lg px-3 py-2 ${
        isSelected ? "border-l-2 border-accent bg-accent/5" : ""
      }`}
    >
      {/* Header row (always visible) */}
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={handleHeaderClick}
      >
        {/* Checkbox in multi-select mode (only for ready retrievers) */}
        {isCheckboxMode && retriever.status === "ready" && (
          <input
            type="checkbox"
            checked={isChecked ?? false}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCheck?.();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border-border bg-bg text-accent focus:ring-accent/50 flex-shrink-0 cursor-pointer"
          />
        )}

        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />

        {/* Retriever name */}
        <span className="text-sm text-text font-medium truncate min-w-0 flex-1">
          {retriever.name}
        </span>

        {/* Chunk count badge */}
        {retriever.chunkCount != null && retriever.chunkCount > 0 && (
          <span className="text-[10px] text-text-dim bg-bg-surface px-1.5 py-0.5 rounded-full flex-shrink-0">
            {retriever.chunkCount}
          </span>
        )}

        {/* Expand/collapse chevron */}
        <svg
          className={`w-3.5 h-3.5 text-text-dim flex-shrink-0 transition-transform duration-150 ${
            isExpanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 animate-fade-in">
          {/* Config summary (4 lines) */}
          {summary && (
            <div className="space-y-0.5 text-[11px]">
              <div className="flex gap-2">
                <span className="text-text-dim w-12 flex-shrink-0">Index</span>
                <span className="text-text-muted truncate">{summary.index}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-text-dim w-12 flex-shrink-0">Query</span>
                <span className="text-text-muted">{summary.query}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-text-dim w-12 flex-shrink-0">Search</span>
                <span className="text-text-muted">{summary.search}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-text-dim w-12 flex-shrink-0">Refine</span>
                <span className="text-text-muted">{summary.refine}</span>
              </div>
            </div>
          )}

          {/* Error message */}
          {retriever.error && (
            <div className="mt-2 text-[11px] text-red-400 truncate" title={retriever.error}>
              {retriever.error}
            </div>
          )}

          {/* Indexing progress bar */}
          {retriever.status === "indexing" && progress && (
            <ProgressBar progress={progress} />
          )}

          {/* Action buttons */}
          <ActionButtons
            status={retriever.status}
            progress={progress}
            onStartIndexing={onStartIndexing}
            onCancelIndexing={onCancelIndexing}
          />

          {/* View Full Config button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewFullConfig();
            }}
            className="mt-2 text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer uppercase tracking-wider font-semibold"
          >
            View Full Config
          </button>
        </div>
      )}
    </div>
  );
}
