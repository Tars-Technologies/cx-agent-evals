"use client";

import { useMemo } from "react";
import {
  type DetailQuestionRow,
  type QuestionStatus,
  STATUS_COLORS,
} from "./types";

export type StatusFilter = "all" | QuestionStatus;

interface QuestionListPaneProps {
  questions: DetailQuestionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
}

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "miss", label: "Miss" },
  { value: "partial", label: "Partial" },
  { value: "hit", label: "Hit" },
];

export function QuestionListPane({
  questions,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: QuestionListPaneProps) {
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, hit: 0, partial: 0, miss: 0 };
    c.all = questions.length;
    for (const q of questions) c[q.status] += 1;
    return c;
  }, [questions]);

  const filtered = useMemo(
    () => (filter === "all" ? questions : questions.filter((q) => q.status === filter)),
    [questions, filter],
  );

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ borderRight: "1px solid var(--color-border)", background: "var(--color-bg-elevated)" }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Questions
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }} className="tabular-nums">
          {filtered.length}
          {filter !== "all" ? ` / ${counts.all}` : ""}
        </span>
      </div>

      <div
        className="px-3 py-2 flex items-center gap-1 flex-wrap"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          const dotColor = opt.value === "all" ? null : STATUS_COLORS[opt.value].dot;
          return (
            <button
              key={opt.value}
              onClick={() => onFilterChange(opt.value)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded transition-colors cursor-pointer"
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                background: isActive ? "var(--color-bg-surface)" : "transparent",
                border: `1px solid ${isActive ? "var(--color-border)" : "transparent"}`,
              }}
            >
              {dotColor && (
                <span
                  className="rounded-full"
                  style={{ width: 6, height: 6, background: dotColor }}
                />
              )}
              {opt.label}
              <span
                className="tabular-nums"
                style={{ fontSize: "10px", color: "var(--color-text-dim)" }}
              >
                {counts[opt.value]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center" style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {questions.length === 0 ? "No results yet." : "No questions match this filter."}
          </div>
        ) : (
          filtered.map((q) => {
            const isSelected = selectedId === q.resultId;
            const status = STATUS_COLORS[q.status];
            const recall = q.scores.recall ?? 0;
            return (
              <button
                key={q.resultId}
                onClick={() => onSelect(q.resultId)}
                className="w-full text-left flex items-start gap-2.5 px-4 py-2.5 transition-colors cursor-pointer"
                style={{
                  borderBottom: "1px solid var(--color-border)",
                  background: isSelected ? "var(--color-bg-surface)" : "transparent",
                  borderLeft: isSelected
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                }}
              >
                <span
                  className="mt-1.5 flex-shrink-0 rounded-full"
                  style={{ width: 6, height: 6, background: status.dot }}
                  aria-label={status.label}
                />
                <span
                  className="flex-1 line-clamp-2"
                  style={{
                    fontSize: "12px",
                    color: isSelected ? "var(--color-text)" : "var(--color-text-muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {q.queryText}
                </span>
                <span
                  className="tabular-nums flex-shrink-0"
                  style={{
                    fontSize: "11px",
                    color: isSelected ? "var(--color-text)" : "var(--color-text-dim)",
                    fontWeight: 500,
                  }}
                >
                  {(recall * 100).toFixed(0)}%
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
