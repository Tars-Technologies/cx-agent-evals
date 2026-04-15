"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex";
import { ChunkCard } from "@/components/ChunkCard";
import type { Id } from "@convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaygroundTabProps {
  selectedRetrieverIds: Set<Id<"retrievers">>;
  retrievers: Array<{
    _id: Id<"retrievers">;
    name: string;
    status: string;
    defaultK: number;
  }>;
}

interface ChunkResult {
  readonly chunkId: string;
  readonly content: string;
  readonly docId: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly metadata: Record<string, unknown>;
}

interface RetrievalResult {
  readonly finalChunks: ChunkResult[];
  readonly totalLatencyMs: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={`w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin ${className ?? ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PlaygroundTab({
  selectedRetrieverIds,
  retrievers,
}: PlaygroundTabProps) {
  const [query, setQuery] = useState("");
  const [resultMap, setResultMap] = useState<Map<string, RetrievalResult>>(
    new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errorMap, setErrorMap] = useState<Map<string, string>>(new Map());

  const retrieveAction = useAction(
    api.retrieval.pipelineActions.retrieveWithTrace,
  );

  const isRunning = loadingIds.size > 0;

  // Only ready + selected retrievers can be queried
  const selectedRetrievers = retrievers.filter(
    (r) => selectedRetrieverIds.has(r._id) && r.status === "ready",
  );

  const noRetrieversSelected = selectedRetrieverIds.size === 0;
  const noReadyRetrievers = selectedRetrievers.length === 0;

  const handleRetrieve = useCallback(async () => {
    if (!query.trim() || selectedRetrievers.length === 0) return;

    // Reset previous results and mark all as loading
    const ids = selectedRetrievers.map((r) => String(r._id));
    setLoadingIds(new Set(ids));
    setResultMap(new Map());
    setErrorMap(new Map());

    await Promise.allSettled(
      selectedRetrievers.map(async (r) => {
        const idStr = String(r._id);
        try {
          const result = await retrieveAction({
            retrieverId: r._id,
            query: query.trim(),
            k: r.defaultK,
          });
          setResultMap((prev) => {
            const next = new Map(prev);
            next.set(idStr, {
              finalChunks: result.finalChunks as ChunkResult[],
              totalLatencyMs: result.totalLatencyMs,
            });
            return next;
          });
        } catch (err) {
          setErrorMap((prev) => {
            const next = new Map(prev);
            next.set(
              idStr,
              err instanceof Error ? err.message : "Retrieval failed",
            );
            return next;
          });
        } finally {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(idStr);
            return next;
          });
        }
      }),
    );
  }, [query, selectedRetrievers, retrieveAction]);

  const hasAnyResults = resultMap.size > 0 || loadingIds.size > 0;

  // Show columns once a retrieval is triggered
  const columnRetrievers = hasAnyResults ? selectedRetrievers : [];

  // Grid column class based on count
  const gridClass =
    columnRetrievers.length === 1
      ? "grid-cols-1"
      : columnRetrievers.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="flex flex-col h-full">
      {/* Query bar */}
      <div className="flex items-center gap-2 p-4 border-b border-border flex-shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !noReadyRetrievers) handleRetrieve();
          }}
          placeholder={
            noRetrieversSelected
              ? "Select a retriever from the dropdown above..."
              : noReadyRetrievers
                ? "Selected retriever is not ready..."
                : "Enter a query to test retrieval..."
          }
          disabled={noReadyRetrievers}
          className={`flex-1 bg-bg-surface border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent/50 focus:outline-none transition-colors ${
            noReadyRetrievers ? "opacity-50" : ""
          }`}
        />
        <button
          type="button"
          onClick={handleRetrieve}
          disabled={!query.trim() || isRunning || noReadyRetrievers}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated disabled:bg-border disabled:text-text-dim transition-colors cursor-pointer"
        >
          {isRunning ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              Retrieving
            </span>
          ) : (
            "Retrieve"
          )}
        </button>
      </div>

      {/* Empty state */}
      {noRetrieversSelected && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-text-dim">
            Select a retriever from the dropdown above.
          </p>
        </div>
      )}

      {/* Selected but none ready */}
      {!noRetrieversSelected && noReadyRetrievers && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-1">
            <p className="text-sm text-text-dim">
              No selected retrievers are ready.
            </p>
            <p className="text-[11px] text-text-dim/60">
              Index the selected retrievers before querying.
            </p>
          </div>
        </div>
      )}

      {/* Results grid */}
      {columnRetrievers.length > 0 && (
        <div className={`grid ${gridClass} gap-4 p-4 flex-1 min-h-0`}>
          {columnRetrievers.map((r) => {
            const idStr = String(r._id);
            const result = resultMap.get(idStr);
            const isLoading = loadingIds.has(idStr);
            const error = errorMap.get(idStr);

            return (
              <div
                key={r._id}
                className="border border-border rounded-lg overflow-hidden flex flex-col"
              >
                {/* Column header */}
                <div className="px-3 py-2 border-b border-border bg-bg-elevated flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text truncate">
                      {r.name}
                    </div>
                    {result && !error && (
                      <div className="text-[11px] text-text-dim">
                        {result.finalChunks.length} chunk
                        {result.finalChunks.length !== 1 ? "s" : ""} &middot;{" "}
                        {result.totalLatencyMs}ms
                      </div>
                    )}
                  </div>
                </div>

                {/* Column content */}
                {isLoading ? (
                  <div className="p-6 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-text-dim text-xs">
                      <Spinner />
                      Retrieving...
                    </div>
                  </div>
                ) : error ? (
                  <div className="p-3">
                    <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                      {error}
                    </div>
                  </div>
                ) : result && result.finalChunks.length === 0 ? (
                  <div className="p-3 text-sm text-text-dim">No results</div>
                ) : result ? (
                  <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
                    {result.finalChunks.map((chunk, i) => (
                      <ChunkCard
                        key={`${chunk.chunkId}-${i}`}
                        rank={i + 1}
                        score={chunk.score}
                        docId={chunk.docId}
                        start={chunk.start}
                        end={chunk.end}
                        content={chunk.content}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Hint when selected but no results yet */}
      {!noRetrieversSelected &&
        !noReadyRetrievers &&
        columnRetrievers.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-1">
              <p className="text-xs text-text-dim">
                Testing:{" "}
                {selectedRetrievers.map((r) => r.name).join(", ")}
              </p>
              <p className="text-[11px] text-text-dim/60">
                Enter a query and press Retrieve to compare results.
              </p>
            </div>
          </div>
        )}
    </div>
  );
}
