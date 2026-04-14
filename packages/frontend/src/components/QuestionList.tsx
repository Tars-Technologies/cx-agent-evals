"use client";

import { useState } from "react";
import { GeneratedQuestion } from "@/lib/types";

export function QuestionList({
  questions,
  selectedIndex,
  onSelect,
  generating,
  totalDone,
  phaseStatus,
  onUpload,
  realWorldCount,
}: {
  questions: GeneratedQuestion[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  generating: boolean;
  totalDone: number | null;
  phaseStatus?: string | null;
  onUpload?: () => void;
  realWorldCount?: number;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter questions by search query
  const filteredQuestions = searchQuery
    ? questions.filter((q) =>
        q.query.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : questions;

  // Group by docId (use original index for correct selection)
  const grouped = new Map<string, { question: GeneratedQuestion; index: number }[]>();
  filteredQuestions.forEach((q) => {
    const originalIndex = questions.indexOf(q);
    const list = grouped.get(q.docId) || [];
    list.push({ question: q, index: originalIndex });
    grouped.set(q.docId, list);
  });

  if (questions.length === 0 && !generating) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Questions will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">
          Questions
        </span>
        <span className="text-[11px] text-text-muted">
          {generating ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
              {questions.length} generated
            </span>
          ) : totalDone !== null ? (
            <>
              {totalDone} total
              {realWorldCount != null && realWorldCount > 0 && (
                <span className="text-accent"> · {realWorldCount} real-world</span>
              )}
            </>
          ) : (
            `${questions.length}`
          )}
        </span>
      </div>

      {/* Search */}
      {questions.length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
        </div>
      )}

      {/* Phase status banner */}
      {generating && phaseStatus && questions.length === 0 && (
        <div className="px-3 py-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-[11px] text-accent font-medium uppercase tracking-wider">
              Pipeline
            </span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            {phaseStatus}
          </p>
        </div>
      )}

      {/* Inline phase status when questions are already showing */}
      {generating && phaseStatus && questions.length > 0 && (
        <div className="px-3 py-2 border-b border-accent/20 bg-accent/5">
          <div className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-[10px] text-accent/80">
              {phaseStatus}
            </span>
          </div>
        </div>
      )}

      {/* Empty generating state (no phase info) */}
      {generating && !phaseStatus && questions.length === 0 && (
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-xs text-text-muted">Starting generation...</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([docId, items]) => (
          <div key={docId}>
            <div className="px-3 py-1.5 bg-bg-surface/50 border-b border-border/50 sticky top-0">
              <span className="text-[10px] text-accent font-medium">
                {docId}
              </span>
            </div>
            {items.map(({ question, index }) => (
              <button
                key={index}
                onClick={() => onSelect(index)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors
                           cursor-pointer animate-slide-in
                           ${
                             selectedIndex === index
                               ? "bg-accent/8 border-l-2 border-l-accent"
                               : "hover:bg-bg-hover border-l-2 border-l-transparent"
                           }`}
                style={{ animationDelay: `${(index % 10) * 30}ms` }}
              >
                <p className="text-xs text-text leading-relaxed">
                  {question.query}
                </p>
                {question.source === "real-world" && (
                  <span className="inline-block text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded mt-1">
                    real-world
                  </span>
                )}
                <span className="text-[10px] text-text-dim mt-1 block">
                  {question.relevantSpans
                    ? `${question.relevantSpans.length} span${question.relevantSpans.length !== 1 ? "s" : ""}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Upload footer */}
      {questions.length > 0 && !generating && onUpload && (
        <div className="flex-shrink-0 px-3 py-2.5 border-t border-border bg-bg-elevated/50">
          <button
            onClick={onUpload}
            className="w-full px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors cursor-pointer"
          >
            Upload to LangSmith
          </button>
        </div>
      )}
    </div>
  );
}
