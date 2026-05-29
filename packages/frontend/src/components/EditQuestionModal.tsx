"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useMutation, useQuery } from "convex/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/convex"
import type { SpanInfo } from "@/lib/types"
import { type DocSearchHit, DocSearchResults } from "./DocSearchResults"

const SPAN_COLORS = [
  "var(--color-chunk-1)",
  "var(--color-chunk-2)",
  "var(--color-chunk-3)",
  "var(--color-chunk-4)",
  "var(--color-chunk-5)"
]

interface EditQuestionModalProps {
  /** Convex question record */
  question: {
    _id: Id<"questions">
    queryText: string
    sourceDocId: string
    relevantSpans: SpanInfo[]
  }
  /** KB ID for loading documents */
  kbId: Id<"knowledgeBases">
  onClose: () => void
  onSaved?: () => void
}

export function EditQuestionModal({
  question,
  kbId,
  onClose,
  onSaved
}: EditQuestionModalProps) {
  const updateQuestion = useMutation(api.kb.questions.updateQuestion)

  // Editable state
  const [queryText, setQueryText] = useState(question.queryText)
  const [spans, setSpans] = useState<SpanInfo[]>([...question.relevantSpans])

  // Track unsaved changes
  const hasChanges =
    queryText !== question.queryText ||
    JSON.stringify(spans) !== JSON.stringify(question.relevantSpans)

  // Delete confirmation
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(
    null
  )

  // Resolve referenced docIds (source + span docs) via point lookup. Includes
  // every doc the user has added a span on, so navigation always has the _id.
  const referencedDocIds = useMemo(() => {
    const set = new Set<string>([question.sourceDocId])
    for (const s of spans) set.add(s.docId)
    return [...set]
  }, [question.sourceDocId, spans])

  const resolvedDocs = useQuery(
    api.kb.documents.getDocsByDocIds,
    referencedDocIds.length > 0 ? { kbId, docIds: referencedDocIds } : "skip"
  )

  const docByDocId = useMemo(() => {
    const map = new Map<string, Pick<DocSearchHit, "_id" | "docId" | "title">>()
    for (const d of resolvedDocs ?? []) {
      map.set(d.docId, { _id: d._id, docId: d.docId, title: d.title })
    }
    return map
  }, [resolvedDocs])

  // Explicit selection from the right-panel search; falls back to the source doc.
  const [pickedDocId, setPickedDocId] = useState<Id<"documents"> | null>(null)
  const selectedDocId =
    pickedDocId ?? docByDocId.get(question.sourceDocId)?._id ?? null

  // Saving state
  const [saving, setSaving] = useState(false)

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Group spans by docId for display
  const spansByDoc = new Map<
    string,
    { span: SpanInfo; globalIndex: number }[]
  >()
  spans.forEach((span, i) => {
    const list = spansByDoc.get(span.docId) || []
    list.push({ span, globalIndex: i })
    spansByDoc.set(span.docId, list)
  })

  // Focused span for scroll-to + glow
  const [focusedSpanIndex, setFocusedSpanIndex] = useState<number | null>(null)

  function handleDeleteSpan(index: number) {
    setSpans((prev) => prev.filter((_, i) => i !== index))
    setConfirmDeleteIndex(null)
  }

  function handleAddSpan(span: SpanInfo) {
    setSpans((prev) => [...prev, span])
  }

  function handleSpanClick(globalIndex: number, span: SpanInfo) {
    navigateToDoc(span.docId)
    setFocusedSpanIndex(globalIndex)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateQuestion({
        questionId: question._id,
        queryText,
        relevantSpans: spans
      })
      onSaved?.()
      onClose()
    } catch {
      setSaving(false)
    }
  }

  function navigateToDoc(docId: string) {
    const doc = docByDocId.get(docId)
    if (doc) setPickedDocId(doc._id)
  }

  function handlePickSearchResult(doc: DocSearchHit) {
    setPickedDocId(doc._id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-2xl flex flex-col animate-fade-in"
        style={{
          width: "95vw",
          maxWidth: 1200,
          height: "80vh",
          maxHeight: 720
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">
              Edit Question
            </span>
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
                {spansByDoc.size > 1
                  ? ` across ${spansByDoc.size} docs`
                  : spansByDoc.size === 1
                    ? " · 1 doc"
                    : ""}
              </span>
            </div>

            {/* Spans list */}
            <div className="flex-1 overflow-y-auto p-2">
              {[...spansByDoc.entries()].map(([docId, items]) => {
                const docRef = docByDocId.get(docId)
                const label = docRef?.title ?? docId
                return (
                  <div key={docId} className="mb-3">
                    <button
                      onClick={() => navigateToDoc(docId)}
                      className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold text-text-muted hover:text-accent transition-colors cursor-pointer rounded hover:bg-bg-hover w-full text-left group"
                    >
                      <span className="text-accent text-[9px]">▶</span>
                      <span className="flex-1 truncate">{label}</span>
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
                        <div
                          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
                          style={{
                            backgroundColor:
                              SPAN_COLORS[globalIndex % SPAN_COLORS.length]
                          }}
                        />

                        {confirmDeleteIndex !== globalIndex && (
                          <button
                            onClick={() => setConfirmDeleteIndex(globalIndex)}
                            className="absolute top-1.5 right-1.5 opacity-0 group-hover/span:opacity-100 text-[9px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5 hover:bg-red-400/20 transition-all cursor-pointer flex items-center gap-1"
                          >
                            ✕ delete
                          </button>
                        )}

                        {confirmDeleteIndex === globalIndex && (
                          <div className="absolute -top-1 right-1 bg-bg-elevated border border-red-500 rounded px-2.5 py-1.5 flex items-center gap-2 shadow-lg z-10">
                            <span className="text-[10px] text-text-muted">
                              Remove?
                            </span>
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

                        <p className="text-text line-clamp-3 pr-12">
                          {span.text}
                        </p>
                        <p className="text-[8px] text-text-dim mt-1">
                          chars {span.start.toLocaleString()} —{" "}
                          {span.end.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              })}

              {spans.length === 0 && (
                <div className="flex items-center justify-center py-8 text-[11px] text-text-dim">
                  Select text in a document to add a span →
                </div>
              )}

              {/* Hint to find another doc */}
              <div className="mt-3 pt-3 border-t border-border px-2">
                <p className="text-[9px] text-text-dim">
                  To add spans from another document, search for it in the right
                  panel.
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <RightPanel
              kbId={kbId}
              selectedDocId={selectedDocId}
              onPickDoc={handlePickSearchResult}
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
            Select text in the document to add a ground truth span ·{" "}
            <kbd className="bg-bg-surface border border-border rounded px-1.5 py-0.5 text-[9px] text-text-muted">
              Esc
            </kbd>{" "}
            to close
          </span>
          <span className="text-[10px] text-text-dim">
            Saving will clear LangSmith sync for re-upload
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Right Panel ───

function RightPanel({
  kbId,
  selectedDocId,
  onPickDoc,
  existingSpans,
  onAddSpan,
  focusedSpanIndex,
  onFocusHandled
}: {
  kbId: Id<"knowledgeBases">
  selectedDocId: Id<"documents"> | null
  onPickDoc: (doc: DocSearchHit) => void
  existingSpans: SpanInfo[]
  onAddSpan: (span: SpanInfo) => void
  focusedSpanIndex: number | null
  onFocusHandled: () => void
}) {
  const [searchQuery, setSearchQuery] = useState("")

  const docContent = useQuery(
    api.kb.documents.getContent,
    selectedDocId ? { id: selectedDocId } : "skip"
  )

  // Text selection state
  const [selection, setSelection] = useState<{
    text: string
    start: number
    end: number
  } | null>(null)

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null)
      return
    }

    const container = document.getElementById("doc-content-area")
    if (!container) return

    const range = sel.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }

    const text = sel.toString().trim()
    if (!text) {
      setSelection(null)
      return
    }

    const preRange = document.createRange()
    preRange.setStart(container, 0)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length
    const end = start + text.length

    setSelection({ text, start, end })
  }, [])

  function handleAddSelection() {
    if (!selection || !docContent) return
    onAddSpan({
      docId: docContent.docId,
      start: selection.start,
      end: selection.end,
      text: selection.text
    })
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  // Scroll to and glow focused span
  useEffect(() => {
    if (focusedSpanIndex === null || !docContent) return
    const timer = setTimeout(() => {
      const container = document.getElementById("doc-content-area")
      if (!container) return
      const mark = container.querySelector(
        `[data-span-index="${focusedSpanIndex}"]`
      )
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" })
        mark.classList.add("span-glow")
        setTimeout(() => mark.classList.remove("span-glow"), 2000)
      }
      onFocusHandled()
    }, 100)
    return () => clearTimeout(timer)
  }, [focusedSpanIndex, docContent, onFocusHandled])

  const docSpans = docContent
    ? existingSpans
        .map((s, i) => ({ ...s, colorIndex: i }))
        .filter((s) => s.docId === docContent.docId)
        .sort((a, b) => a.start - b.start)
    : []

  function renderContent(content: string) {
    if (docSpans.length === 0) return content

    const parts: React.ReactNode[] = []
    let lastEnd = 0

    docSpans.forEach((span, i) => {
      if (span.start > lastEnd) {
        parts.push(content.slice(lastEnd, span.start))
      }
      parts.push(
        <mark
          key={`h-${i}`}
          data-span-index={span.colorIndex}
          style={{
            backgroundColor: SPAN_COLORS[span.colorIndex % SPAN_COLORS.length],
            color: "var(--color-text)",
            borderRadius: 2,
            padding: "1px 0"
          }}
        >
          {content.slice(span.start, span.end)}
        </mark>
      )
      lastEnd = span.end
    })

    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd))
    }

    return <>{parts}</>
  }

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-2.5 bg-bg-surface border-b border-border flex flex-col gap-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Search documents by title…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
        />
      </div>

      <DocSearchResults
        kbId={kbId}
        query={searchQuery}
        limit={20}
        variant="inline"
        renderRow={(r) => (
          <button
            key={r._id}
            onClick={() => {
              onPickDoc(r)
              setSearchQuery("")
            }}
            className="w-full text-left px-3 py-1.5 border-b border-border last:border-b-0 hover:bg-bg-hover transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span className="text-accent font-medium min-w-[180px] truncate">
              {r.title}
            </span>
            <span className="text-text-muted text-[10px]">
              {r.contentLength.toLocaleString()} chars
            </span>
          </button>
        )}
      />

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
            {selectedDocId
              ? "Loading document..."
              : "Search for a document to view its content"}
          </div>
        )}

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
  )
}
