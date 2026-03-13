"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex";
import { ChunkCard } from "@/components/ChunkCard";
import { resolveConfig } from "@/lib/pipeline-types";
import type { PipelineConfig } from "@/lib/pipeline-types";
import type { Id } from "@convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuerySearchTabProps {
  retriever: {
    _id: Id<"retrievers">;
    retrieverConfig: any;
    defaultK: number;
    status: string;
  };
  query: string;
  onQueryChange: (query: string) => void;
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

interface RewriteResult {
  readonly strategy: string;
  readonly original: string;
  readonly rewrittenQueries: string[];
  readonly hypotheticalAnswer?: string;
  readonly latencyMs: number;
}

interface SearchResult {
  readonly searchConfig: Record<string, unknown>;
  readonly perQueryResults: ReadonlyArray<{
    readonly query: string;
    readonly chunks: ChunkResult[];
  }>;
  readonly fusedResults: ChunkResult[];
  readonly latencyMs: number;
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

/** Strategy display name mapping. */
function strategyLabel(strategy: string): string {
  switch (strategy) {
    case "identity":
      return "Identity (no rewriting)";
    case "multi-query":
      return "Multi-Query";
    case "step-back":
      return "Step-Back";
    case "hyde":
      return "HyDE";
    case "rewrite":
      return "Rewrite";
    default:
      return strategy;
  }
}

// ---------------------------------------------------------------------------
// Query Rewriting Panel (left)
// ---------------------------------------------------------------------------

function QueryRewritingPanel({
  rewriteResult,
  selectedQueryIndex,
  onSelectQueryIndex,
  isRewriting,
  queryStrategy,
}: {
  rewriteResult: RewriteResult | null;
  selectedQueryIndex: number | null;
  onSelectQueryIndex: (index: number | null) => void;
  isRewriting: boolean;
  queryStrategy: string;
}) {
  const [hydeExpanded, setHydeExpanded] = useState(false);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <span className="text-[11px] text-text-muted font-medium">
          Query Rewriting
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Static config box — always visible */}
        <div className="bg-bg-surface border border-border rounded-lg p-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
            <span>
              Strategy: <span className="text-text-muted">{strategyLabel(queryStrategy)}</span>
            </span>
          </div>
        </div>

        {/* Spinner while rewriting */}
        {isRewriting && (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Spinner />
            <span className="text-[11px] text-text-dim">Rewriting query...</span>
          </div>
        )}

        {/* Rewrite results (after running) */}
        {rewriteResult && !isRewriting && (() => {
          const { strategy, original, rewrittenQueries, hypotheticalAnswer, latencyMs } =
            rewriteResult;
          const isIdentity = strategy === "identity";

          return (
            <>
              {/* Radio options */}
              <div className="space-y-1">
                {/* Fused / Original option — always first */}
                <RadioOption
                  label={
                    isIdentity || rewrittenQueries.length === 1
                      ? "Original"
                      : "Original (fused results)"
                  }
                  sublabel={original}
                  isSelected={selectedQueryIndex === null}
                  onSelect={() => onSelectQueryIndex(null)}
                />

                {/* Rewritten query options (skip for identity) */}
                {!isIdentity &&
                  rewrittenQueries.map((q, i) => (
                    <RadioOption
                      key={i}
                      label={`${i + 1}. "${truncate(q, 60)}"`}
                      isSelected={selectedQueryIndex === i}
                      onSelect={() => onSelectQueryIndex(i)}
                    />
                  ))}
              </div>

              {/* HyDE: hypothetical answer */}
              {strategy === "hyde" && hypotheticalAnswer && (
                <div className="space-y-1">
                  <span className="text-[10px] text-text-dim uppercase tracking-wider">
                    Hypothetical Answer
                  </span>
                  <div className="bg-bg-surface border border-border rounded-lg p-2 text-xs text-text-muted">
                    <p className={hydeExpanded ? "" : "line-clamp-3"}>
                      {hypotheticalAnswer}
                    </p>
                    <button
                      type="button"
                      onClick={() => setHydeExpanded((prev) => !prev)}
                      className="text-[10px] text-accent hover:text-accent-bright mt-1 cursor-pointer"
                    >
                      {hydeExpanded ? "Show less" : "Show more"}
                    </button>
                  </div>
                </div>
              )}

              {/* Latency */}
              <p className="text-[11px] text-text-dim">
                Latency: {latencyMs}ms
              </p>
            </>
          );
        })()}

        {/* Empty state (before running) */}
        {!rewriteResult && !isRewriting && (
          <div className="text-xs text-text-dim text-center py-4">
            Run a query to see rewriting results.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radio Option
// ---------------------------------------------------------------------------

function RadioOption({
  label,
  sublabel,
  isSelected,
  onSelect,
}: {
  label: string;
  sublabel?: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/10 border border-accent/20"
          : "hover:bg-bg-surface border border-transparent"
      }`}
    >
      {/* Radio dot */}
      <span
        className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
          isSelected ? "border-accent bg-accent" : "border-border"
        }`}
      />
      <span className="min-w-0">
        <span className="text-xs text-text block truncate">{label}</span>
        {sublabel && (
          <span className="text-[10px] text-text-dim block truncate">
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Search Results Panel (right)
// ---------------------------------------------------------------------------

function SearchResultsPanel({
  searchResult,
  selectedQueryIndex,
  isSearching,
  staticSearchConfig,
}: {
  searchResult: SearchResult | null;
  selectedQueryIndex: number | null;
  isSearching: boolean;
  staticSearchConfig: { strategy: string; k: number; denseWeight?: number; sparseWeight?: number; fusionMethod?: string };
}) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <span className="text-[11px] text-text-muted font-medium">
          Search Results
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Static config box — always visible */}
        <div className="m-3 bg-bg-surface border border-border rounded-lg p-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
            <span>
              Strategy: <span className="text-text-muted">{staticSearchConfig.strategy}</span>
            </span>
            {staticSearchConfig.denseWeight != null && (
              <span>
                Dense: <span className="text-text-muted">{staticSearchConfig.denseWeight}</span>
              </span>
            )}
            {staticSearchConfig.sparseWeight != null && (
              <span>
                Sparse: <span className="text-text-muted">{staticSearchConfig.sparseWeight}</span>
              </span>
            )}
            {staticSearchConfig.fusionMethod != null && (
              <span>
                Fusion: <span className="text-text-muted">{staticSearchConfig.fusionMethod}</span>
              </span>
            )}
            <span>
              k: <span className="text-text-muted">{staticSearchConfig.k}</span>
            </span>
          </div>
        </div>

        {/* Spinner */}
        {isSearching && (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Spinner />
            <span className="text-[11px] text-text-dim">Searching...</span>
          </div>
        )}

        {/* Results (after running) — include latency in result header */}
        {searchResult && !isSearching && (() => {
          const { perQueryResults, fusedResults, latencyMs } = searchResult;

          // Determine which chunks to display
          const showingFused = selectedQueryIndex === null;
          const displayChunks = showingFused
            ? fusedResults
            : perQueryResults[selectedQueryIndex]?.chunks ?? [];

          // Result header text
          const resultHeader = showingFused
            ? perQueryResults.length > 1
              ? `Showing: fused results (${fusedResults.length} chunks from ${perQueryResults.length} queries)`
              : `Showing: results (${fusedResults.length} chunks)`
            : `Showing: results for query ${selectedQueryIndex + 1} (${displayChunks.length} chunks)`;

          return (
            <>
              {/* Result header with latency */}
              <div className="px-3 pb-2">
                <p className="text-[11px] text-text-dim">{resultHeader} &middot; {latencyMs}ms</p>
              </div>

              {/* Chunk list */}
              {displayChunks.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-text-dim">
                  No results found.
                </div>
              ) : (
                <div className="px-3 pb-3 space-y-2">
                  {displayChunks.map((chunk, i) => (
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
              )}
            </>
          );
        })()}

        {/* Empty state */}
        {!searchResult && !isSearching && (
          <div className="text-xs text-text-dim text-center py-4">
            Run a query to see search results.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function QuerySearchTab({
  retriever,
  query,
  onQueryChange,
}: QuerySearchTabProps) {
  // Resolve static config for always-visible config boxes
  const resolved = resolveConfig(retriever.retrieverConfig as PipelineConfig);

  const staticSearchConfig = {
    strategy: resolved.search.strategy,
    k: resolved.k,
    ...(resolved.search.strategy === "hybrid" ? {
      denseWeight: (resolved.search as any).denseWeight as number | undefined,
      sparseWeight: (resolved.search as any).sparseWeight as number | undefined,
      fusionMethod: (resolved.search as any).fusionMethod as string | undefined,
    } : {}),
  };

  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(
    null,
  );
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [selectedQueryIndex, setSelectedQueryIndex] = useState<number | null>(
    null,
  );
  const [isRewriting, setIsRewriting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewriteQueryAction = useAction(
    api.retrieval.pipelineActions.rewriteQuery,
  );
  const searchAction = useAction(
    api.retrieval.pipelineActions.searchWithQueries,
  );

  const handleRun = useCallback(async () => {
    if (!query.trim()) return;

    setError(null);
    setIsRewriting(true);
    setSearchResult(null);
    setRewriteResult(null);

    try {
      const rewrite = (await rewriteQueryAction({
        retrieverId: retriever._id,
        query: query.trim(),
      })) as RewriteResult;
      setRewriteResult(rewrite);
      setSelectedQueryIndex(null);

      setIsSearching(true);
      setIsRewriting(false);

      const search = (await searchAction({
        retrieverId: retriever._id,
        queries: rewrite.rewrittenQueries,
        k: retriever.defaultK,
      })) as SearchResult;
      setSearchResult(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setIsRewriting(false);
      setIsSearching(false);
    }
  }, [
    query,
    retriever._id,
    retriever.defaultK,
    rewriteQueryAction,
    searchAction,
  ]);

  // Non-ready state
  if (retriever.status !== "ready") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm text-text-dim">
            This retriever hasn&apos;t been indexed yet.
          </p>
          <p className="text-[11px] text-text-dim/60">
            Start indexing from the retriever card to inspect the query
            pipeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Query bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border flex-shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRun();
          }}
          placeholder="Enter a query to test the pipeline..."
          className="flex-1 bg-bg-surface border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={!query.trim() || isRewriting || isSearching}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated disabled:bg-border disabled:text-text-dim transition-colors cursor-pointer"
        >
          {isRewriting || isSearching ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              Running
            </span>
          ) : (
            "Run"
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Split panels */}
      <div className="flex flex-1 min-h-0 border-t border-border">
        {/* Left: Query Rewriting (~35%) */}
        <div className="w-[35%] flex-shrink-0 border-r border-border overflow-hidden">
          <QueryRewritingPanel
            rewriteResult={rewriteResult}
            selectedQueryIndex={selectedQueryIndex}
            onSelectQueryIndex={setSelectedQueryIndex}
            isRewriting={isRewriting}
            queryStrategy={resolved.query.strategy}
          />
        </div>

        {/* Right: Search Results (~65%) */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <SearchResultsPanel
            searchResult={searchResult}
            selectedQueryIndex={selectedQueryIndex}
            isSearching={isSearching}
            staticSearchConfig={staticSearchConfig}
          />
        </div>
      </div>
    </div>
  );
}
