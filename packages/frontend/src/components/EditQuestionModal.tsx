"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { SpanInfo } from "@/lib/types";
import { searchDocuments } from "@/lib/fuzzySearch";

const SPAN_COLORS = [
  "var(--color-chunk-1)",
  "var(--color-chunk-2)",
  "var(--color-chunk-3)",
  "var(--color-chunk-4)",
  "var(--color-chunk-5)",
];

interface EditQuestionModalProps {
  /** Convex question record */
  question: {
    _id: Id<"questions">;
    queryText: string;
    sourceDocId: string;
    relevantSpans: SpanInfo[];
  };
  /** KB ID for loading documents */
  kbId: Id<"knowledgeBases">;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditQuestionModal({
  question,
  kbId,
  onClose,
  onSaved,
}: EditQuestionModalProps) {
  const updateQuestion = useMutation(api.crud.questions.updateQuestion);

  // Editable state
  const [queryText, setQueryText] = useState(question.queryText);
  const [spans, setSpans] = useState<SpanInfo[]>([...question.relevantSpans]);

  // Track unsaved changes
  const hasChanges =
    queryText !== question.queryText ||
    JSON.stringify(spans) !== JSON.stringify(question.relevantSpans);

  // Delete confirmation
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  // Documents list for the KB
  const documents = useQuery(api.crud.documents.listByKb, { kbId });

  // Selected document in right panel
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Group spans by docId for display
  const spansByDoc = new Map<string, { span: SpanInfo; globalIndex: number }[]>();
  spans.forEach((span, i) => {
    const list = spansByDoc.get(span.docId) || [];
    list.push({ span, globalIndex: i });
    spansByDoc.set(span.docId, list);
  });

  // Unique doc IDs that already have spans
  const docsWithSpans = new Set(spans.map((s) => s.docId));

  // Documents that don't have spans yet (for "add from another doc" chips)
  const docsWithoutSpans = (documents ?? []).filter(
    (d) => !docsWithSpans.has(d.docId),
  );

  // Focused span for scroll-to + glow
  const [focusedSpanIndex, setFocusedSpanIndex] = useState<number | null>(null);

  function handleDeleteSpan(index: number) {
    setSpans((prev) => prev.filter((_, i) => i !== index));
    setConfirmDeleteIndex(null);
  }

  function handleAddSpan(span: SpanInfo) {
    setSpans((prev) => [...prev, span]);
  }

  // Navigate to a span: open its document and focus it
  function handleSpanClick(globalIndex: number, span: SpanInfo) {
    navigateToDoc(span.docId);
    setFocusedSpanIndex(globalIndex);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateQuestion({
        questionId: question._id,
        queryText,
        relevantSpans: spans,
      });
      onSaved?.();
      onClose();
    } catch {
      setSaving(false);
    }
  }

  // Navigate to a document in the right panel
  function navigateToDoc(docId: string) {
    const doc = (documents ?? []).find((d) => d.docId === docId);
    if (doc) setSelectedDocId(doc._id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-2xl flex flex-col animate-fade-in"
        style={{ width: "95vw", maxWidth: 1200, height: "80vh", maxHeight: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">Edit Question</span>
            <span className="text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded font-medium">
              {question._id.slice(-4)}
            </span>
            <span className="text-[10px] text-text-dim">
              — generated from {question.sourceDocId}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-[10px] text-text-dim flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Unsaved changes
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:bg-bg-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 text-xs font-semibold bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Body — split panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT PANEL */}
          <div className="w-[380px] min-w-[320px] border-r border-border flex flex-col overflow-hidden">
            {/* Question text */}
            <div className="p-4 border-b border-border flex-shrink-0">
              <label className="block text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-2">
                Question Text
              </label>
              <textarea
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                className="w-full bg-bg border border-border rounded px-3 py-2.5 text-[13px] text-text leading-relaxed resize-vertical min-h-[60px] focus:border-accent outline-none font-[inherit]"
              />
            </div>

            {/* Spans section header */}
            <div className="px-4 py-2 bg-bg-surface border-b border-border flex items-center justify-between flex-shrink-0">
              <span className="text-[9px] font-semibold text-text-dim uppercase tracking-wider">
                Ground Truth Spans
              </span>
              <span className="text-[10px] text-accent font-medium">
                {spans.length} span{spans.length !== 1 ? "s" : ""}
                {spansByDoc.size > 1 ? ` across ${spansByDoc.size} docs` : spansByDoc.size === 1 ? " · 1 doc" : ""}
              </span>
            </div>

            {/* Spans list */}
            <div className="flex-1 overflow-y-auto p-2">
              {[...spansByDoc.entries()].map(([docId, items]) => (
                <div key={docId} className="mb-3">
                  <button
                    onClick={() => navigateToDoc(docId)}
                    className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold text-text-muted hover:text-accent transition-colors cursor-pointer rounded hover:bg-bg-hover w-full text-left group"
                  >
                    <span className="text-accent text-[9px]">▶</span>
                    <span className="flex-1 truncate">{docId}</span>
                    <span className="text-[8px] text-text-dim opacity-0 group-hover:opacity-100">
                      → view
                    </span>
                  </button>
                  {items.map(({ span, globalIndex }) => (
                    <div
                      key={globalIndex}
                      onClick={() => handleSpanClick(globalIndex, span)}
                      className={`relative bg-bg border border-border rounded mx-1 my-1 px-2.5 py-2 text-[10px] leading-relaxed transition-colors group/span hover:border-border-bright cursor-pointer ${
                        confirmDeleteIndex === globalIndex
                          ? "border-red-500/30 bg-red-500/5"
                          : ""
                      }`}
                    >
                      {/* Color bar */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
                        style={{
                          backgroundColor: SPAN_COLORS[globalIndex % SPAN_COLORS.length],
                        }}
                      />

                      {/* Delete button (hover) */}
                      {confirmDeleteIndex !== globalIndex && (
                        <button
                          onClick={() => setConfirmDeleteIndex(globalIndex)}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover/span:opacity-100 text-[9px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5 hover:bg-red-400/20 transition-all cursor-pointer flex items-center gap-1"
                        >
                          ✕ delete
                        </button>
                      )}

                      {/* Inline confirmation */}
                      {confirmDeleteIndex === globalIndex && (
                        <div className="absolute -top-1 right-1 bg-bg-elevated border border-red-500 rounded px-2.5 py-1.5 flex items-center gap-2 shadow-lg z-10">
                          <span className="text-[10px] text-text-muted">Remove?</span>
                          <button
                            onClick={() => handleDeleteSpan(globalIndex)}
                            className="text-[9px] font-semibold bg-red-500 text-white px-2 py-0.5 rounded cursor-pointer"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteIndex(null)}
                            className="text-[9px] text-text-muted border border-border px-2 py-0.5 rounded cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      )}

                      {/* Span text */}
                      <p className="text-text line-clamp-3 pr-12">{span.text}</p>
                      <p className="text-[8px] text-text-dim mt-1">
                        chars {span.start.toLocaleString()} — {span.end.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ))}

              {/* "Add from another doc" section */}
              {docsWithoutSpans.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border px-2">
                  <p className="text-[9px] text-text-dim mb-2">
                    Add spans from another document:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {docsWithoutSpans.map((doc) => (
                      <button
                        key={doc._id}
                        onClick={() => setSelectedDocId(doc._id)}
                        className="text-[9px] text-text-muted bg-bg border border-border px-2 py-1 rounded hover:border-accent/30 hover:text-accent transition-colors cursor-pointer truncate max-w-[200px]"
                      >
                        {doc.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {spans.length === 0 && (
                <div className="flex items-center justify-center py-8 text-[11px] text-text-dim">
                  Select text in a document to add a span →
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <RightPanel
              documents={documents ?? []}
              selectedDocId={selectedDocId}
              onSelectDoc={setSelectedDocId}
              existingSpans={spans}
              onAddSpan={handleAddSpan}
              focusedSpanIndex={focusedSpanIndex}
              onFocusHandled={() => setFocusedSpanIndex(null)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border flex-shrink-0">
          <span className="text-[10px] text-text-dim">
            Select text in the document to add a ground truth span · <kbd className="bg-bg-surface border border-border rounded px-1.5 py-0.5 text-[9px] text-text-muted">Esc</kbd> to close
          </span>
          <span className="text-[10px] text-text-dim">
            Saving will clear LangSmith sync for re-upload
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Right Panel ───

function RightPanel({
  documents,
  selectedDocId,
  onSelectDoc,
  existingSpans,
  onAddSpan,
  focusedSpanIndex,
  onFocusHandled,
}: {
  documents: { _id: Id<"documents">; docId: string; title: string }[];
  selectedDocId: Id<"documents"> | null;
  onSelectDoc: (id: Id<"documents">) => void;
  existingSpans: SpanInfo[];
  onAddSpan: (span: SpanInfo) => void;
  focusedSpanIndex: number | null;
  onFocusHandled: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Load selected document content
  const docContent = useQuery(
    api.crud.documents.getContent,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // Load all doc contents for search (lazy — only when search is active)
  const [loadedDocs, setLoadedDocs] = useState<
    Map<string, { docId: string; title: string; content: string }>
  >(new Map());

  // When docContent loads, cache it
  useEffect(() => {
    if (docContent) {
      setLoadedDocs((prev) => {
        const next = new Map(prev);
        next.set(docContent.docId, {
          docId: docContent.docId,
          title: docContent.docId,
          content: docContent.content,
        });
        return next;
      });
    }
  }, [docContent]);

  // Search results (searchDocuments imported at top of file)
  const searchResults = searchQuery.trim()
    ? searchDocuments(searchQuery, [...loadedDocs.values()], 10)
    : [];

  // Text selection state
  const [selection, setSelection] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);

  // Handle text selection in document
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null);
      return;
    }

    const container = document.getElementById("doc-content-area");
    if (!container) return;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }

    // Calculate character offset within the document content
    // Walk text nodes to find the start offset
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + text.length;

    setSelection({ text, start, end });
  }, []);

  function handleAddSelection() {
    if (!selection || !docContent) return;
    onAddSpan({
      docId: docContent.docId,
      start: selection.start,
      end: selection.end,
      text: selection.text,
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  // Scroll to and glow focused span
  useEffect(() => {
    if (focusedSpanIndex === null || !docContent) return;
    // Small delay to let the document render after navigation
    const timer = setTimeout(() => {
      const container = document.getElementById("doc-content-area");
      if (!container) return;
      const mark = container.querySelector(`[data-span-index="${focusedSpanIndex}"]`);
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        mark.classList.add("span-glow");
        setTimeout(() => mark.classList.remove("span-glow"), 2000);
      }
      onFocusHandled();
    }, 100);
    return () => clearTimeout(timer);
  }, [focusedSpanIndex, docContent, onFocusHandled]);

  // Highlights for existing spans in the currently viewed doc
  const docSpans = docContent
    ? existingSpans
        .map((s, i) => ({ ...s, colorIndex: i }))
        .filter((s) => s.docId === docContent.docId)
        .sort((a, b) => a.start - b.start)
    : [];

  // Render highlighted document content
  function renderContent(content: string) {
    if (docSpans.length === 0) return content;

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    docSpans.forEach((span, i) => {
      if (span.start > lastEnd) {
        parts.push(content.slice(lastEnd, span.start));
      }
      parts.push(
        <mark
          key={`h-${i}`}
          data-span-index={span.colorIndex}
          style={{
            backgroundColor: SPAN_COLORS[span.colorIndex % SPAN_COLORS.length],
            color: "var(--color-text)",
            borderRadius: 2,
            padding: "1px 0",
          }}
        >
          {content.slice(span.start, span.end)}
        </mark>,
      );
      lastEnd = span.end;
    });

    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd));
    }

    return <>{parts}</>;
  }

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-2.5 bg-bg-surface border-b border-border flex flex-col gap-2 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search across all documents in KB..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
          <select
            value={selectedDocId ?? ""}
            onChange={(e) => {
              if (e.target.value) onSelectDoc(e.target.value as Id<"documents">);
            }}
            className="bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text min-w-[180px] focus:border-accent outline-none"
          >
            <option value="">Select document...</option>
            {documents.map((d) => (
              <option key={d._id} value={d._id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        {searchQuery && (
          <span className="text-[9px] text-text-dim">
            {searchResults.length} match{searchResults.length !== 1 ? "es" : ""} across {loadedDocs.size} of {documents.length} documents
          </span>
        )}
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="bg-bg-surface border-b border-border px-4 py-2 max-h-[140px] overflow-y-auto flex-shrink-0">
          {searchResults.map((r: { docId: string; docTitle: string; snippet: string; matchStart: number }, i: number) => (
            <button
              key={i}
              onClick={() => {
                const doc = documents.find((d) => d.docId === r.docId);
                if (doc) onSelectDoc(doc._id);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-[10px] hover:bg-bg-hover transition-colors flex items-center gap-2 cursor-pointer"
            >
              <span className="text-accent font-medium min-w-[120px] truncate">
                {r.docTitle}
              </span>
              <span className="text-text-muted truncate">{r.snippet}</span>
            </button>
          ))}
        </div>
      )}

      {/* Document content */}
      <div
        id="doc-content-area"
        className="flex-1 overflow-y-auto p-4 relative"
        onMouseUp={handleMouseUp}
      >
        {docContent ? (
          <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-all font-[inherit]">
            {renderContent(docContent.content)}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full text-[11px] text-text-dim">
            {selectedDocId ? "Loading document..." : "Select a document to view its content"}
          </div>
        )}

        {/* Floating action bar for text selection */}
        {selection && docContent && (
          <div className="sticky bottom-4 mx-auto w-fit bg-bg-elevated border border-accent rounded-md px-4 py-2 flex items-center gap-3 shadow-xl">
            <span className="text-[10px] text-text-muted">Selected</span>
            <span className="text-[9px] text-accent font-medium">
              {selection.text.length} chars
            </span>
            <button
              onClick={handleAddSelection}
              className="text-[10px] font-semibold bg-accent text-bg-elevated px-3 py-1 rounded cursor-pointer hover:bg-accent/90 transition-colors"
            >
              + Add as Span
            </button>
          </div>
        )}
      </div>
    </>
  );
}
