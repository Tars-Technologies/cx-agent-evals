"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";

type Rating = "great" | "good_enough" | "bad";
type FilterType = "all" | "unrated" | Rating;

interface QuestionItem {
  questionId: Id<"questions">;
  queryText: string;
  resultId: Id<"agentExperimentResults"> | null;
  rating: Rating | null;
  hasComment: boolean;
}

interface ExperimentQuestionListProps {
  items: QuestionItem[];
  selectedQuestionId: Id<"questions"> | null;
  onSelectQuestion: (questionId: Id<"questions">) => void;
  stats: {
    total: number;
    annotated: number;
    great: number;
    good_enough: number;
    bad: number;
  } | null;
  isLive: boolean;
  pendingCount: number;
}

function StatusDot({ rating }: { rating: Rating | null }) {
  if (rating === null) {
    return <span className="mt-1 w-2 h-2 rounded-full border border-border shrink-0" />;
  }
  const colors: Record<Rating, string> = {
    great: "bg-green-500",
    good_enough: "bg-yellow-500",
    bad: "bg-red-500",
  };
  return (
    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${colors[rating]}`} />
  );
}

function PendingDot() {
  return (
    <span className="mt-1 w-2 h-2 rounded-full border-2 border-purple-400/40 shrink-0 animate-pulse" />
  );
}

export function ExperimentQuestionList({
  items,
  selectedQuestionId,
  onSelectQuestion,
  stats,
  isLive,
  pendingCount,
}: ExperimentQuestionListProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedQuestionId]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (filter !== "all") {
      if (filter === "unrated") {
        result = result.filter((item) => item.rating === null && item.resultId !== null);
      } else {
        result = result.filter((item) => item.rating === filter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((item) =>
        item.queryText.toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, filter, searchQuery]);

  const totalItems = items.length;
  const annotatedCount = stats?.annotated ?? 0;
  const totalCount = stats?.total ?? totalItems;

  const greatPct = totalCount > 0 ? ((stats?.great ?? 0) / totalCount) * 100 : 0;
  const goodPct = totalCount > 0 ? ((stats?.good_enough ?? 0) / totalCount) * 100 : 0;
  const badPct = totalCount > 0 ? ((stats?.bad ?? 0) / totalCount) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-text">Questions</span>
        <span className="text-xs text-text-dim">
          <span className="text-accent font-medium">{annotatedCount}</span>
          /{totalCount} annotated
        </span>
      </div>

      {/* Annotation progress bar */}
      {totalCount > 0 && (
        <div className="flex h-1 w-full">
          <div
            className="bg-green-500 h-full transition-all"
            style={{ width: `${greatPct}%` }}
          />
          <div
            className="bg-yellow-500 h-full transition-all"
            style={{ width: `${goodPct}%` }}
          />
          <div
            className="bg-red-500 h-full transition-all"
            style={{ width: `${badPct}%` }}
          />
        </div>
      )}

      {/* Search */}
      <div className="p-3 border-b border-border space-y-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search questions..."
          className="w-full px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        />

        {/* Filter buttons */}
        <div className="flex gap-1.5">
          {(["all", "unrated"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                filter === f
                  ? "border-accent text-accent"
                  : "border-border text-text-dim hover:border-border/80"
              }`}
            >
              {f === "all" ? "All" : "Unrated"}
            </button>
          ))}
        </div>
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="p-4 text-xs text-text-dim text-center">
            No questions match filters.
          </div>
        ) : (
          filteredItems.map((item, i) => {
            const isSelected = item.questionId === selectedQuestionId;
            const isPending = item.resultId === null;

            return (
              <button
                key={item.questionId}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelectQuestion(item.questionId)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors flex items-start gap-2.5 ${
                  isSelected
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : isPending
                      ? "opacity-50 border-l-2 border-l-transparent"
                      : "hover:bg-bg-elevated border-l-2 border-l-transparent"
                }`}
              >
                {isPending ? (
                  <PendingDot />
                ) : (
                  <StatusDot rating={item.rating} />
                )}

                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm leading-snug line-clamp-2 ${
                      isPending ? "text-text-dim" : "text-text"
                    }`}
                  >
                    {item.queryText}
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
                    {item.hasComment && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/70" />
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}

        {/* Live pending footer */}
        {isLive && pendingCount > 0 && (
          <div className="px-3 py-2 text-xs text-text-dim italic">
            {pendingCount} more pending...
          </div>
        )}
      </div>
    </div>
  );
}
