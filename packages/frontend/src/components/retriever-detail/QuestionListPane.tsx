"use client";

import { type DetailQuestionRow, STATUS_COLORS } from "./types";

interface QuestionListPaneProps {
  questions: DetailQuestionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function QuestionListPane({ questions, selectedId, onSelect }: QuestionListPaneProps) {
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
          {questions.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {questions.length === 0 ? (
          <div className="px-4 py-6 text-center" style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            No results yet.
          </div>
        ) : (
          questions.map((q) => {
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
