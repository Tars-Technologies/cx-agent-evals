"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

interface RetrieverInfo {
  _id: Id<"retrievers">;
  name: string;
  defaultK: number;
}

interface RetrieverPlaygroundProps {
  selectedRetrievers: RetrieverInfo[];
}

interface RetrievalChunk {
  chunkId: string;
  content: string;
  score: number;
  docId?: string;
  start?: number;
  end?: number;
}

interface RetrievalResult {
  retrieverId: string;
  retrieverName: string;
  chunks: RetrievalChunk[];
  latencyMs: number;
  error?: string;
}

export function RetrieverPlayground({
  selectedRetrievers,
}: RetrieverPlaygroundProps) {
  const [query, setQuery] = useState("");
  // Map from retrieverId → result (streaming: each slot set as its promise resolves)
  const [resultMap, setResultMap] = useState<Record<string, RetrievalResult>>({});
  // Set of retriever IDs currently loading
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  // Set of expanded chunk indices, keyed as "retrieverId:chunkIndex"
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());

  const retrieve = useAction(api.retrieval.retrieverActions.retrieve);

  const isRunning = loadingIds.size > 0;

  const handleRetrieve = useCallback(async () => {
    if (!query.trim() || selectedRetrievers.length === 0 || isRunning) return;

    // Reset state
    setResultMap({});
    setExpandedChunks(new Set());
    const ids = new Set(selectedRetrievers.map((r) => r._id as string));
    setLoadingIds(ids);

    // Fire all retrieves in parallel, streaming results as they arrive
    for (const r of selectedRetrievers) {
      const start = performance.now();
      retrieve({ retrieverId: r._id, query: query.trim() })
        .then((chunks) => {
          const result: RetrievalResult = {
            retrieverId: r._id,
            retrieverName: r.name,
            chunks: chunks as RetrievalChunk[],
            latencyMs: Math.round(performance.now() - start),
          };
          setResultMap((prev) => ({ ...prev, [r._id]: result }));
        })
        .catch((err) => {
          const result: RetrievalResult = {
            retrieverId: r._id,
            retrieverName: r.name,
            chunks: [],
            latencyMs: Math.round(performance.now() - start),
            error: err instanceof Error ? err.message : "Retrieval failed",
          };
          setResultMap((prev) => ({ ...prev, [r._id]: result }));
        })
        .finally(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(r._id);
            return next;
          });
        });
    }
  }, [query, selectedRetrievers, isRunning, retrieve]);

  function toggleExpand(key: string) {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const noRetrieversSelected = selectedRetrievers.length === 0;
  const hasAnyResults = Object.keys(resultMap).length > 0 || loadingIds.size > 0;
  // Show columns for all selected retrievers once a retrieve is triggered
  const columnRetrievers = hasAnyResults ? selectedRetrievers : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !noRetrieversSelected && handleRetrieve()}
          placeholder={noRetrieversSelected ? "Select ready retrievers above to test queries..." : "Enter a query to test..."}
          className={`flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors ${
            noRetrieversSelected ? "opacity-50" : ""
          }`}
        />
        <button
          onClick={handleRetrieve}
          disabled={!query.trim() || isRunning || noRetrieversSelected}
          className="px-4 py-2 rounded border text-xs font-semibold uppercase tracking-wider
                     transition-all cursor-pointer
                     bg-accent/10 border-accent/30 text-accent hover:bg-accent/20
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Retrieving...
            </div>
          ) : (
            "Retrieve"
          )}
        </button>
      </div>

      {noRetrieversSelected ? (
        <div className="text-[11px] text-text-dim">
          Check one or more ready retrievers above to compare results
        </div>
      ) : (
        <div className="text-[11px] text-text-dim">
          Testing: {selectedRetrievers.map((r) => r.name).join(", ")}
        </div>
      )}

      {columnRetrievers.length > 0 && (
        <div className={`grid gap-4 ${
          columnRetrievers.length === 1
            ? "grid-cols-1"
            : columnRetrievers.length === 2
              ? "grid-cols-1 lg:grid-cols-2"
              : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
        }`}>
          {columnRetrievers.map((r) => {
            const result = resultMap[r._id];
            const isLoading = loadingIds.has(r._id);

            return (
              <div
                key={r._id}
                className="border border-border rounded-lg overflow-hidden"
              >
                {/* Column header with name, result count, latency */}
                <div className="px-3 py-2 border-b border-border bg-bg-elevated flex items-center justify-between">
                  <span className="text-xs text-text font-medium truncate">
                    {r.name}
                    {result && !result.error && (
                      <span className="text-text-dim ml-1.5">
                        ({result.chunks.length} result{result.chunks.length !== 1 ? "s" : ""})
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-text-dim flex-shrink-0 ml-2">
                    {result ? `${result.latencyMs}ms` : ""}
                  </span>
                </div>

                {/* Content area */}
                {isLoading ? (
                  <div className="p-6 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-text-dim text-xs">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Retrieving...
                    </div>
                  </div>
                ) : result?.error ? (
                  <div className="p-3 text-sm text-red-400">{result.error}</div>
                ) : result && result.chunks.length === 0 ? (
                  <div className="p-3 text-sm text-text-dim">No results</div>
                ) : result ? (
                  <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
                    {result.chunks.map((chunk, i) => {
                      const expandKey = `${result.retrieverId}:${i}`;
                      const isExpanded = expandedChunks.has(expandKey);
                      const docRef = chunk.docId && chunk.start != null && chunk.end != null
                        ? `${chunk.docId}:${chunk.start}-${chunk.end}`
                        : chunk.docId ?? null;

                      return (
                        <div
                          key={i}
                          className="p-3 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
                          onClick={() => toggleExpand(expandKey)}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-text-dim">
                                #{i + 1}
                              </span>
                              {docRef && (
                                <span className="text-[10px] text-text-dim font-mono">
                                  {docRef}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-accent font-mono">
                              {chunk.score.toFixed(2)}
                            </span>
                          </div>
                          <p className={`text-xs text-text-muted leading-relaxed ${
                            isExpanded ? "" : "line-clamp-3"
                          }`}>
                            {chunk.content}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
