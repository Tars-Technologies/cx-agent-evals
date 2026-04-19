"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentInfo, GeneratedQuestion } from "@/lib/types";
import { MarkdownViewer } from "@/components/MarkdownViewer";

type ViewMode = "raw" | "rendered";

const HIGHLIGHT_COLORS = [
  "var(--color-chunk-1)",
  "var(--color-chunk-2)",
  "var(--color-chunk-3)",
  "var(--color-chunk-4)",
  "var(--color-chunk-5)",
];

interface HighlightSpan {
  start: number;
  end: number;
  colorIndex: number;
}

function computeHighlights(
  doc: DocumentInfo,
  question: GeneratedQuestion,
): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  if (question.relevantSpans) {
    question.relevantSpans.forEach((span, i) => {
      if (String(span.docId) === doc.id) {
        spans.push({
          start: span.start,
          end: span.end,
          colorIndex: i % HIGHLIGHT_COLORS.length,
        });
      }
    });
  }

  // Sort by start position
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

function renderHighlightedText(content: string, highlights: HighlightSpan[]) {
  if (highlights.length === 0) {
    return <span>{content}</span>;
  }

  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  highlights.forEach((span, i) => {
    // Text before this highlight
    if (span.start > lastEnd) {
      parts.push(
        <span key={`t-${i}`}>{content.slice(lastEnd, span.start)}</span>,
      );
    }

    // Highlighted text
    parts.push(
      <mark
        key={`h-${i}`}
        data-highlight={i}
        className={i === 0 ? "first-highlight" : ""}
        style={{
          backgroundColor: HIGHLIGHT_COLORS[span.colorIndex],
          color: "var(--color-text)",
        }}
      >
        {content.slice(span.start, span.end)}
      </mark>,
    );

    lastEnd = span.end;
  });

  // Remaining text
  if (lastEnd < content.length) {
    parts.push(<span key="tail">{content.slice(lastEnd)}</span>);
  }

  return <>{parts}</>;
}

export function DocumentViewer({
  doc,
  question,
  allDocIds,
  onNavigateDoc,
}: {
  doc: DocumentInfo | null;
  question: GeneratedQuestion | null;
  /** All document IDs relevant to the current question (source + span docs) */
  allDocIds?: string[];
  /** Called when user navigates to a different doc */
  onNavigateDoc?: (docId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const highlights = question && doc ? computeHighlights(doc, question) : [];
  const hasHighlights = highlights.length > 0;

  // Multi-doc navigation
  const showDocNav = allDocIds && allDocIds.length > 1 && doc;
  const currentDocIndex = showDocNav ? allDocIds.indexOf(doc.id) : -1;

  const [viewMode, setViewMode] = useState<ViewMode>(
    hasHighlights ? "raw" : "rendered",
  );

  // When highlights appear/disappear (e.g. selecting a different question),
  // switch to raw mode so the user sees them immediately.
  useEffect(() => {
    if (hasHighlights) {
      setViewMode("raw");
    }
  }, [hasHighlights]);

  useEffect(() => {
    if (viewMode !== "raw") return;
    if (!containerRef.current) return;
    const firstMark = containerRef.current.querySelector(".first-highlight");
    if (firstMark) {
      firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [question, viewMode]);

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select a question to view its source document
      </div>
    );
  }

  const noHighlights = question && highlights.length === 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-xs text-accent font-medium">{doc.id}</span>
        <div className="flex items-center gap-3">
          {showDocNav && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onNavigateDoc!(allDocIds[currentDocIndex - 1])}
                disabled={currentDocIndex <= 0}
                className="px-1.5 py-0.5 text-[10px] text-text-muted border border-border rounded hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                ‹
              </button>
              <span className="text-[10px] text-text-muted">
                {currentDocIndex + 1} of {allDocIds.length} docs
              </span>
              <button
                onClick={() => onNavigateDoc!(allDocIds[currentDocIndex + 1])}
                disabled={currentDocIndex >= allDocIds.length - 1}
                className="px-1.5 py-0.5 text-[10px] text-text-muted border border-border rounded hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                ›
              </button>
            </div>
          )}
          {hasHighlights && (
            <span className="text-[10px] text-text-muted">
              {highlights.length} span{highlights.length !== 1 ? "s" : ""}
            </span>
          )}
          <span className="text-[10px] text-text-dim" title={`${doc.contentLength.toLocaleString()} characters`}>
            {doc.contentLength >= 1000 ? `${Math.round(doc.contentLength / 1000)}k chars` : `${doc.contentLength} chars`}
          </span>
          <div className="inline-flex items-center bg-elevated border border-border rounded-full text-[10px] overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={`px-2 py-0.5 transition-colors ${
                viewMode === "raw"
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => setViewMode("rendered")}
              className={`px-2 py-0.5 transition-colors ${
                viewMode === "rendered"
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Rendered
            </button>
          </div>
        </div>
      </div>

      {noHighlights && (
        <div className="px-4 py-2 bg-warn/5 border-b border-warn/20">
          <span className="text-[11px] text-warn">
            No relevant spans found for this question
          </span>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {question && (
          <div className="mx-4 mt-4 mb-4 pb-3 border-b border-border/50 animate-fade-in">
            <span className="text-[10px] text-text-dim uppercase tracking-wider block mb-1">
              Question
            </span>
            <p className="text-xs text-accent-bright leading-relaxed">
              {question.query}
            </p>
          </div>
        )}

        {viewMode === "rendered" ? (
          <>
            {hasHighlights && (
              <div className="mx-4 mb-2">
                <span className="text-[10px] text-text-dim italic">
                  Switch to raw mode to see highlights
                </span>
              </div>
            )}
            <MarkdownViewer
              content={doc.content}
              showToggle={false}
              defaultMode="rendered"
            />
          </>
        ) : (
          <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-all font-[inherit] max-w-full overflow-hidden p-4">
            {renderHighlightedText(doc.content, highlights)}
          </pre>
        )}
      </div>
    </div>
  );
}
