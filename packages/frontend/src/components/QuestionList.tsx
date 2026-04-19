"use client";

import { useState } from "react";
import { GeneratedQuestion } from "@/lib/types";

type SourceFilter = "all" | "generated" | "real-world";

export function QuestionList({
  questions,
  selectedIndex,
  onSelect,
  onEdit,
  generating,
  totalDone,
  phaseStatus,
  onUpload,
  realWorldCount,
}: {
  questions: GeneratedQuestion[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onEdit?: (index: number) => void;
  generating: boolean;
  totalDone: number | null;
  phaseStatus?: string | null;
  onUpload?: () => void;
  realWorldCount?: number;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Filter questions by search query and source type
  const filteredQuestions = questions
    .map((q, index) => ({ question: q, originalIndex: index }))
    .filter(({ question }) => {
      if (searchQuery && !question.query.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (sourceFilter === "real-world" && question.source !== "real-world") return false;
      if (sourceFilter === "generated" && question.source === "real-world") return false;
      return true;
    });

  // Count unique docIds across spans for a question
  function spanDocCount(q: GeneratedQuestion): number {
    if (!q.relevantSpans || q.relevantSpans.length === 0) return 0;
    return new Set(q.relevantSpans.map((s) => s.docId)).size;
  }

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

      {/* Search + Filters */}
      {questions.length > 0 && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
          <div className="flex gap-1">
            {(["all", "generated", "real-world"] as SourceFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                  sourceFilter === f
                    ? "bg-accent/15 text-accent"
                    : "text-text-dim hover:text-text-muted"
                }`}
              >
                {f === "all" ? "All" : f === "generated" ? "Generated" : "Real-world"}
              </button>
            ))}
          </div>
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

      {/* Flat question list */}
      <div className="flex-1 overflow-y-auto">
        {filteredQuestions.map(({ question, originalIndex }) => {
          const docCount = spanDocCount(question);
          return (
            <button
              key={originalIndex}
              onClick={() => onSelect(originalIndex)}
              className={`group w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors
                         cursor-pointer animate-slide-in
                         ${
                           selectedIndex === originalIndex
                             ? "bg-accent/8 border-l-2 border-l-accent"
                             : "hover:bg-bg-hover border-l-2 border-l-transparent"
                         }`}
              style={{ animationDelay: `${(originalIndex % 10) * 30}ms` }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text leading-relaxed flex-1">
                  {question.query}
                </p>
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(originalIndex);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-text-dim hover:text-accent transition-all cursor-pointer flex-shrink-0"
                    title="Edit question"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {question.source === "real-world" && (
                  <span className="text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded">
                    real-world
                  </span>
                )}
                {question.relevantSpans && question.relevantSpans.length > 0 && (
                  <span className="text-[10px] text-text-dim">
                    {question.relevantSpans.length} span{question.relevantSpans.length !== 1 ? "s" : ""}
                  </span>
                )}
                {docCount > 1 && (
                  <span className="text-[9px] text-text-dim bg-bg-surface px-1.5 py-0.5 rounded">
                    {docCount} docs
                  </span>
                )}
              </div>
            </button>
          );
        })}
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
