"use client";

import { useEffect, useRef } from "react";
import type { FilterType } from "./types";

interface QuestionListPaneProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  results: any[];
  questionMap: Map<string, any>;
  annotationMap: Map<string, any>;
  currentResultId: string | null;
  onSelectResult: (index: number) => void;
  stats: {
    total: number;
    annotated: number;
    great: number;
    good_enough: number;
    bad: number;
  } | null;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  tagFilter: string;
  onTagFilterChange: (t: string) => void;
  allTags: string[];
}

export function QuestionListPane({
  results,
  questionMap,
  annotationMap,
  currentResultId,
  onSelectResult,
  stats,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  tagFilter,
  onTagFilterChange,
  allTags,
}: QuestionListPaneProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentResultId]);

  return (
    <div className="w-72 border-r border-border shrink-0 flex flex-col h-full bg-bg">
      {/* Progress */}
      {stats && (
        <div className="px-3 py-2 border-b border-border">
          <span className="text-xs text-text-dim">
            <span className="text-accent font-medium">{stats.annotated}</span>
            /{stats.total} annotated
          </span>
        </div>
      )}

      {/* Search */}
      <div className="p-3 space-y-2 border-b border-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search questions..."
          className="w-full px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        />

        {/* Rating filter */}
        <select
          value={filter}
          onChange={(e) => onFilterChange(e.target.value as FilterType)}
          className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
        >
          <option value="all">All ({stats?.total ?? 0})</option>
          <option value="unrated">
            Unrated ({(stats?.total ?? 0) - (stats?.annotated ?? 0)})
          </option>
          <option value="great">Great ({stats?.great ?? 0})</option>
          <option value="good_enough">
            Good Enough ({stats?.good_enough ?? 0})
          </option>
          <option value="bad">Bad ({stats?.bad ?? 0})</option>
        </select>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
          >
            <option value="">All Tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Question list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="p-4 text-xs text-text-dim text-center">
            No results match filters.
          </div>
        ) : (
          results.map((r, i) => {
            const question = questionMap.get(r.questionId);
            const annotation = annotationMap.get(r._id);
            const isSelected = r._id === currentResultId;

            return (
              <button
                key={r._id}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelectResult(i)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors flex items-start gap-2.5 ${
                  isSelected
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-elevated border-l-2 border-l-transparent"
                }`}
              >
                {/* Status dot */}
                <StatusDot rating={annotation?.rating} />

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text line-clamp-2 leading-snug">
                    {question?.queryText ?? "Loading..."}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {/* Index number */}
                    <span className="text-[10px] text-text-dim font-mono">
                      #{i + 1}
                    </span>
                    {/* Tag indicator */}
                    {annotation?.tags?.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                        {annotation.tags.length} tag
                        {annotation.tags.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {/* Comment indicator */}
                    {annotation?.comment && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/70" />
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusDot({ rating }: { rating?: string }) {
  if (!rating) {
    return (
      <span className="mt-1 w-3 h-3 rounded-full border-2 border-border shrink-0" />
    );
  }
  const colors: Record<string, string> = {
    great: "bg-accent",
    good_enough: "bg-yellow-400",
    bad: "bg-red-400",
  };
  return (
    <span
      className={`mt-1 w-3 h-3 rounded-full shrink-0 ${colors[rating] ?? "bg-border"}`}
    />
  );
}
