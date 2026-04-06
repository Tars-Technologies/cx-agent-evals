"use client";

import { useEffect, useRef } from "react";
import type { FilterType } from "./types";

export type QuestionItem = { question: any; result: any | null };

interface QuestionListPaneProps {
  items: QuestionItem[];
  annotationMap: Map<string, any>;
  currentIndex: number;
  onSelectResult: (index: number) => void;
  stats: {
    total: number;
    annotated: number;
    great: number;
    good_enough: number;
    bad: number;
  } | null;
  totalQuestions: number;
  totalResults: number;
  isLive: boolean;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  tagFilter: string;
  onTagFilterChange: (t: string) => void;
  allTags: string[];
}

export function QuestionListPane({
  items,
  annotationMap,
  currentIndex,
  onSelectResult,
  stats,
  totalQuestions,
  totalResults,
  isLive,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  tagFilter,
  onTagFilterChange,
  allTags,
}: QuestionListPaneProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  return (
    <div className="w-72 border-r border-border shrink-0 flex flex-col h-full bg-bg">
      {/* Progress */}
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs text-text-dim">
          {stats ? (
            <>
              <span className="text-accent font-medium">{stats.annotated}</span>
              /{stats.total} annotated
            </>
          ) : (
            <>
              <span className="text-accent font-medium">{totalResults}</span>
              /{totalQuestions} evaluated
            </>
          )}
        </span>
        {isLive && (
          <span className="ml-2 text-[10px] text-purple-300">
            (live)
          </span>
        )}
      </div>

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
          <option value="all">All ({totalQuestions})</option>
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
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-4 text-xs text-text-dim text-center">
            No results match filters.
          </div>
        ) : (
          items.map(({ question, result }, i) => {
            const annotation = result ? annotationMap.get(result._id) : null;
            const isSelected = i === currentIndex;
            const isPending = result === null;

            return (
              <button
                key={question?._id ?? i}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelectResult(i)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors flex items-start gap-2.5 ${
                  isSelected
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : isPending
                      ? "opacity-50 border-l-2 border-l-transparent"
                      : "hover:bg-bg-elevated border-l-2 border-l-transparent"
                }`}
              >
                {/* Status indicator */}
                {isPending ? (
                  <PendingDot />
                ) : (
                  <StatusDot rating={annotation?.rating} />
                )}

                <div className="flex-1 min-w-0">
                  <div className={`text-sm leading-snug line-clamp-2 ${isPending ? "text-text-dim" : "text-text"}`}>
                    {question?.queryText ?? "Loading..."}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-text-dim font-mono">
                      #{i + 1}
                    </span>
                    {isPending && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300">
                        pending
                      </span>
                    )}
                    {annotation?.tags?.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                        {annotation.tags.length} tag
                        {annotation.tags.length !== 1 ? "s" : ""}
                      </span>
                    )}
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

function PendingDot() {
  return (
    <span className="mt-1 w-3 h-3 rounded-full border-2 border-purple-400/40 shrink-0 animate-pulse" />
  );
}
