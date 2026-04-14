"use client";

import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { resolveConfig } from "@/lib/pipeline-types";
import type { PipelineConfig } from "@/lib/pipeline-types";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexTabProps {
  retriever: {
    _id: Id<"retrievers">;
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    retrieverConfig: unknown;
    status: string;
    chunkCount?: number;
  };
  onStartIndexing: () => void;
}

/** A chunk as returned by the paginated query (no embedding). */
interface Chunk {
  _id: string;
  chunkId: string;
  documentId: string;
  content: string;
  start: number;
  end: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={`w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin ${className ?? ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Click-to-highlight helpers
// ---------------------------------------------------------------------------

/** Find chunk(s) that contain the given character position. */
function findChunksAtPosition(
  chunks: Chunk[],
  position: number,
): { primary: number | null; overlap: number | null } {
  let primary: number | null = null;
  let overlap: number | null = null;

  for (let i = 0; i < chunks.length; i++) {
    if (position >= chunks[i].start && position < chunks[i].end) {
      if (primary === null) {
        primary = i;
      } else {
        overlap = i;
        break;
      }
    }
  }

  return { primary, overlap };
}

/**
 * Render document content split into per-line spans with data-offset
 * for character-position detection on click.
 * When a chunk is selected, its character range is highlighted.
 */
function ClickableDocumentContent({
  content,
  chunks,
  selectedChunkIndex,
  overlapChunkIndex,
  onSelectChunk,
}: {
  content: string;
  chunks: Chunk[];
  selectedChunkIndex: number | null;
  overlapChunkIndex: number | null;
  onSelectChunk: (index: number | null) => void;
}) {
  const contentRef = useRef<HTMLPreElement>(null);

  // Split content into lines, each in a span with data-offset
  const lines = useMemo(() => {
    const result: Array<{ text: string; offset: number }> = [];
    let pos = 0;
    const parts = content.split("\n");
    for (let i = 0; i < parts.length; i++) {
      result.push({ text: parts[i], offset: pos });
      pos += parts[i].length + 1; // +1 for \n
    }
    return result;
  }, [content]);

  // Click handler: map click to character position, find chunk
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Walk up from target to find span with data-offset
      let el = e.target as HTMLElement | null;
      while (el && !el.dataset.offset) {
        el = el.parentElement;
      }
      if (!el?.dataset.offset) return;

      const lineOffset = parseInt(el.dataset.offset, 10);

      // Use Selection API to get offset within the text node
      const selection = window.getSelection();
      let charOffset = 0;
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        charOffset = range.startOffset;
      }

      const position = lineOffset + charOffset;
      const hit = findChunksAtPosition(chunks, position);

      if (hit.primary !== null) {
        onSelectChunk(hit.primary);
      } else {
        onSelectChunk(null);
      }
    },
    [chunks, onSelectChunk],
  );

  // Escape to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectChunk(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onSelectChunk]);

  // Scroll to selected chunk
  useEffect(() => {
    if (selectedChunkIndex === null || !contentRef.current) return;
    const chunk = chunks[selectedChunkIndex];
    if (!chunk) return;
    const spans = contentRef.current.querySelectorAll("[data-offset]");
    for (const span of spans) {
      const offset = parseInt((span as HTMLElement).dataset.offset ?? "0", 10);
      if (offset >= chunk.start) {
        span.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
    }
  }, [selectedChunkIndex, chunks]);

  // Build highlight ranges
  const selectedChunk = selectedChunkIndex !== null ? chunks[selectedChunkIndex] : null;
  const overlapChunk = overlapChunkIndex !== null ? chunks[overlapChunkIndex] : null;

  // Render a line, applying highlights if the line intersects a selected chunk
  const renderLine = useCallback(
    (line: { text: string; offset: number }, idx: number) => {
      const lineEnd = line.offset + line.text.length;

      // Check if this line intersects any highlighted chunk
      const intersectsSelected =
        selectedChunk && line.offset < selectedChunk.end && lineEnd > selectedChunk.start;
      const intersectsOverlap =
        overlapChunk && line.offset < overlapChunk.end && lineEnd > overlapChunk.start;

      if (!intersectsSelected && !intersectsOverlap) {
        return (
          <span key={idx} data-offset={line.offset}>
            {line.text}
            {"\n"}
          </span>
        );
      }

      // Build sub-segments within this line for highlighting
      const segments: React.ReactNode[] = [];
      let cursor = 0;
      const text = line.text;

      // Collect highlight ranges within this line
      type Range = { start: number; end: number; cls: string };
      const ranges: Range[] = [];
      if (selectedChunk) {
        const s = Math.max(0, selectedChunk.start - line.offset);
        const e = Math.min(text.length, selectedChunk.end - line.offset);
        if (s < e) ranges.push({ start: s, end: e, cls: "bg-accent/10" });
      }
      if (overlapChunk) {
        const s = Math.max(0, overlapChunk.start - line.offset);
        const e = Math.min(text.length, overlapChunk.end - line.offset);
        if (s < e) ranges.push({ start: s, end: e, cls: "bg-blue-400/10" });
      }

      // Sort ranges by start
      ranges.sort((a, b) => a.start - b.start);

      for (const range of ranges) {
        if (range.start > cursor) {
          segments.push(text.slice(cursor, range.start));
        }
        segments.push(
          <span key={`hl-${range.start}`} className={range.cls}>
            {text.slice(range.start, range.end)}
          </span>,
        );
        cursor = range.end;
      }
      if (cursor < text.length) {
        segments.push(text.slice(cursor));
      }

      return (
        <span key={idx} data-offset={line.offset}>
          {segments}
          {"\n"}
        </span>
      );
    },
    [selectedChunk, overlapChunk],
  );

  return (
    <div className="relative">
      {/* Chunk boundary hairlines (left margin) */}
      {chunks.length > 0 && (
        <div className="absolute left-0 top-0 w-1 h-full pointer-events-none">
          {chunks.map((chunk, i) => {
            // Approximate position (line-based; exact calc needs layout measurement)
            const chunkLine = lines.findIndex(
              (l) => l.offset + l.text.length >= chunk.start,
            );
            if (chunkLine < 0) return null;
            const totalLines = lines.length;
            const pct = (chunkLine / Math.max(totalLines, 1)) * 100;
            return (
              <div
                key={i}
                className="absolute w-full bg-accent/20"
                style={{ top: `${pct}%`, height: "1px" }}
              />
            );
          })}
        </div>
      )}

      {/* Document text */}
      <pre
        ref={contentRef}
        className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-words font-mono max-w-full pl-3 cursor-text"
        onClick={handleClick}
      >
        {lines.map(renderLine)}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document List Panel
// ---------------------------------------------------------------------------

function DocumentListPanel({
  kbId,
  selectedDocId,
  onSelect,
}: {
  kbId: Id<"knowledgeBases">;
  selectedDocId: Id<"documents"> | null;
  onSelect: (id: Id<"documents">) => void;
}) {
  const { results: docs, status, loadMore } = usePaginatedQuery(
    api.crud.documents.listByKb,
    { kbId },
    { initialNumItems: 50 },
  );

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="p-3 text-xs text-text-dim">No documents in this KB.</div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {docs.map((doc) => {
        const isActive = selectedDocId === doc._id;
        return (
          <button
            key={doc._id}
            type="button"
            onClick={() => onSelect(doc._id as Id<"documents">)}
            className={`w-full text-left px-3 py-2 transition-colors ${
              isActive
                ? "bg-accent/10 border-l-2 border-accent"
                : "border-l-2 border-transparent hover:bg-bg-elevated"
            }`}
          >
            <span className="text-xs text-text truncate block">{doc.docId}</span>
            <span className="text-[10px] text-text-dim">
              {(doc.contentLength ?? 0).toLocaleString()} chars
            </span>
          </button>
        );
      })}
      {status === "CanLoadMore" && (
        <button
          type="button"
          onClick={() => loadMore(50)}
          className="w-full px-3 py-2 text-xs text-accent hover:bg-bg-elevated transition-colors"
        >
          Load more...
        </button>
      )}
      {status === "LoadingMore" && (
        <div className="flex items-center justify-center p-2">
          <Spinner />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Viewer Panel (center)
// ---------------------------------------------------------------------------

function DocumentViewerPanel({
  docContent,
  chunks,
  chunksLoading,
  selectedChunkIndex,
  onSelectChunk,
  isReady,
}: {
  docContent: { docId: string; content: string } | null | undefined;
  chunks: Chunk[];
  chunksLoading: boolean;
  selectedChunkIndex: number | null;
  onSelectChunk: (index: number | null) => void;
  /** Whether the retriever has been indexed (chunks exist). */
  isReady: boolean;
}) {
  const [viewMode, setViewMode] = useState<"raw" | "rendered">(
    isReady ? "raw" : "rendered",
  );

  if (docContent === undefined || (isReady && chunksLoading && chunks.length === 0)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (!docContent) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-text-dim">
        Document not found.
      </div>
    );
  }

  const hasChunks = chunks.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <span className="text-xs text-accent font-medium truncate">
          {docContent.docId}
        </span>
        <div className="flex items-center gap-3">
          {hasChunks && (
            <span className="text-[10px] text-text-muted">
              {chunks.length} chunk{chunks.length !== 1 ? "s" : ""}
              {chunksLoading ? "+" : ""}
            </span>
          )}
          <span className="text-[10px] text-text-dim">
            {docContent.content.length.toLocaleString()} chars
          </span>
          {/* Raw/Rendered toggle */}
          <div className="flex items-center bg-bg-surface rounded-full p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                viewMode === "raw"
                  ? "bg-accent/20 text-accent"
                  : "text-text-dim hover:text-text"
              }`}
            >
              raw
            </button>
            <button
              type="button"
              onClick={() => setViewMode("rendered")}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                viewMode === "rendered"
                  ? "bg-accent/20 text-accent"
                  : "text-text-dim hover:text-text"
              }`}
            >
              rendered
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === "raw" ? (
          <ClickableDocumentContent
            content={docContent.content}
            chunks={chunks}
            selectedChunkIndex={selectedChunkIndex}
            overlapChunkIndex={null}
            onSelectChunk={onSelectChunk}
          />
        ) : (
          <>
            <MarkdownViewer
              content={docContent.content}
              showToggle={false}
              defaultMode="rendered"
            />
            {hasChunks && (
              <p className="mt-2 text-[10px] text-text-dim italic">
                Switch to raw mode to highlight and inspect chunks.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Chunk List Panel (right, top half)
// ---------------------------------------------------------------------------

function ChunkListPanel({
  chunks,
  selectedIndex,
  onSelect,
}: {
  chunks: Chunk[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [jumpTo, setJumpTo] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const maxSize = useMemo(
    () => Math.max(...chunks.map((c) => c.end - c.start), 1),
    [chunks],
  );

  const filtered = useMemo(() => {
    if (!search) return chunks.map((c, i) => ({ chunk: c, index: i }));
    const lower = search.toLowerCase();
    return chunks
      .map((c, i) => ({ chunk: c, index: i }))
      .filter(({ chunk }) => chunk.content.toLowerCase().includes(lower));
  }, [chunks, search]);

  const handleJump = () => {
    const n = parseInt(jumpTo, 10);
    if (n >= 1 && n <= chunks.length) {
      onSelect(n - 1);
      setJumpTo("");
    }
  };

  return (
    <div className="flex flex-col h-1/2 border-b border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex items-center gap-2">
        <span className="text-[11px] text-text-muted font-medium flex-shrink-0">
          Chunks ({chunks.length})
        </span>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0 bg-bg-surface border border-border text-text text-[11px] rounded px-1.5 py-0.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50"
        />
        <input
          type="text"
          placeholder="#"
          value={jumpTo}
          onChange={(e) => setJumpTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJump()}
          className="w-10 bg-bg-surface border border-border text-text text-[11px] rounded px-1.5 py-0.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50 text-center"
        />
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filtered.map(({ chunk, index }) => {
          const size = chunk.end - chunk.start;
          const isSelected = selectedIndex === index;
          return (
            <button
              key={chunk._id}
              onClick={() => onSelect(index)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors cursor-pointer ${
                isSelected
                  ? "bg-accent/10 border-l-2 border-accent"
                  : "hover:bg-bg-hover border-l-2 border-transparent"
              }`}
              style={{ height: 28 }}
            >
              <span className="text-[10px] text-text-dim w-8 text-right flex-shrink-0">
                #{index + 1}
              </span>
              <span className="text-[10px] text-text-muted w-12 flex-shrink-0">
                {size}ch
              </span>
              <div className="flex-1 h-2 bg-bg-surface rounded overflow-hidden">
                <div
                  className="h-full bg-accent/30 rounded"
                  style={{ width: `${(size / maxSize) * 100}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chunk Detail Panel (right, bottom half)
// ---------------------------------------------------------------------------

function ChunkDetailPanel({
  chunk,
  index,
  total,
  documentContent,
  onPrev,
  onNext,
}: {
  chunk: Chunk;
  index: number;
  total: number;
  documentContent: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [showContent, setShowContent] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const size = chunk.end - chunk.start;
  const originalText = documentContent.slice(chunk.start, chunk.end);

  // Detect extra content (contextual prefix or summary replacement)
  const hasPrefix =
    chunk.content.length > originalText.length &&
    chunk.content.endsWith(originalText);
  const prefix = hasPrefix
    ? chunk.content.slice(0, chunk.content.length - originalText.length)
    : null;

  const isSummary =
    !hasPrefix && chunk.content !== originalText && chunk.content.length > 0;

  // Parent-child info
  const isChild = chunk.metadata?.level === "child";
  const isParent = chunk.metadata?.level === "parent";

  const metadataEntries = Object.entries(chunk.metadata ?? {}).filter(
    ([k]) => !["level", "parentChunkId"].includes(k),
  );

  return (
    <div className="flex flex-col h-1/2">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Header */}
        <div>
          <div className="text-xs text-text font-medium">Chunk #{index + 1}</div>
          <div className="text-[10px] text-text-dim">
            chars {chunk.start.toLocaleString()}{"\u2192"}{chunk.end.toLocaleString()} {"\u00B7"} {size} chars
          </div>
        </div>

        {/* Parent-child info */}
        {isChild && !!chunk.metadata?.parentChunkId && (
          <div className="text-[10px] text-accent/80 bg-accent/5 border border-accent/20 rounded px-2 py-1">
            Part of a parent chunk
          </div>
        )}
        {isParent && (
          <div className="text-[10px] text-accent/80 bg-accent/5 border border-accent/20 rounded px-2 py-1">
            Parent chunk (not embedded — children are searched)
          </div>
        )}

        {/* Contextual prefix */}
        {prefix && (
          <div>
            <div className="text-[10px] text-blue-400 font-medium uppercase tracking-wider mb-1">
              Contextual Prefix
            </div>
            <div className="bg-blue-500/5 border border-blue-500/20 rounded p-2">
              <pre className="text-[11px] text-blue-300 whitespace-pre-wrap font-mono">
                {prefix.trim()}
              </pre>
            </div>
          </div>
        )}

        {/* Summary replacement */}
        {isSummary && (
          <div>
            <div className="text-[10px] text-yellow-400 font-medium uppercase tracking-wider mb-1">
              Embedded Summary
            </div>
            <p className="text-[10px] text-text-dim mb-1">
              This summary was embedded instead of the original text.
            </p>
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded p-2">
              <pre className="text-[11px] text-yellow-300 whitespace-pre-wrap font-mono">
                {chunk.content}
              </pre>
            </div>
          </div>
        )}

        {/* Chunk content divider */}
        {(prefix || isSummary) && (
          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <div className="flex-1 h-px bg-border" />
            chunk content follows
            <div className="flex-1 h-px bg-border" />
          </div>
        )}

        {/* Collapsible chunk text */}
        <button
          onClick={() => setShowContent(!showContent)}
          className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
        >
          {showContent ? "\u25B2 Hide" : "\u25B6 Show"} chunk text ({size} chars)
        </button>
        {showContent && (
          <pre className="text-[11px] text-text-muted whitespace-pre-wrap font-mono bg-bg-surface rounded p-2 max-h-48 overflow-auto">
            {originalText}
          </pre>
        )}

        {/* Collapsible metadata */}
        {metadataEntries.length > 0 && (
          <>
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="text-[10px] text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              {showMetadata ? "\u25B2" : "\u25B6"} Metadata ({metadataEntries.length} keys)
            </button>
            {showMetadata && (
              <div className="bg-bg-surface rounded p-2 space-y-1">
                {metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-[10px]">
                    <span className="text-text-dim font-mono flex-shrink-0">{key}:</span>
                    <span className="text-text-muted truncate">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <button
          onClick={onPrev}
          disabled={index === 0}
          className="text-[10px] text-text-dim hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {"\u2190"} Prev
        </button>
        <span className="text-[10px] text-text-dim">
          {index + 1}/{total}
        </span>
        <button
          onClick={onNext}
          disabled={index === total - 1}
          className="text-[10px] text-text-dim hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Next {"\u2192"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Banner
// ---------------------------------------------------------------------------

function StatsBanner({
  retrieverConfig,
  chunks,
  chunkCount,
}: {
  retrieverConfig: unknown;
  chunks: Chunk[];
  chunkCount?: number;
}) {
  const [showHistogram, setShowHistogram] = useState(false);
  const config = resolveConfig(retrieverConfig as PipelineConfig);
  const { embeddingModel } = config.index;
  const embedShort = embeddingModel.replace("text-embedding-", "");

  const strategy = config.index.strategy;
  const isParentChild = strategy === "parent-child";
  const chunkerLabel = isParentChild
    ? `Parent-child (${config.index.childChunkSize ?? 200}/${config.index.parentChunkSize ?? 1000})`
    : `Recursive (${config.index.chunkSize}/${config.index.chunkOverlap})`;

  // Compute stats from loaded chunks
  const stats = useMemo(() => {
    if (chunks.length === 0) return null;
    const sizes = chunks.map((c) => c.end - c.start);
    const total = chunkCount ?? chunks.length;
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);

    // Compute overlap %
    let overlapChars = 0;
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const overlap = sorted[i - 1].end - sorted[i].start;
      if (overlap > 0) overlapChars += overlap;
    }
    const overlapPct =
      avg > 0 ? Math.round((overlapChars / sorted.length / avg) * 100) : 0;

    // Histogram buckets (100-char width)
    const bucketWidth = 100;
    const buckets = new Map<number, number>();
    for (const s of sizes) {
      const bucket = Math.floor(s / bucketWidth) * bucketWidth;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    const maxCount = Math.max(...sortedBuckets.map(([, c]) => c));

    return { total, avg, min, max, overlapPct, sortedBuckets, maxCount };
  }, [chunks, chunkCount]);

  return (
    <div className="px-3 py-2 border-b border-border flex-shrink-0">
      <div className="bg-bg-surface border border-border rounded-lg p-2 space-y-2">
        {/* Config row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
          <span className="text-text-muted font-medium">Index</span>
          <span>
            Chunking: <span className="text-text-muted">{chunkerLabel}</span>
          </span>
          <span>
            Embedding: <span className="text-text-muted">{embedShort}</span>
          </span>
          {isParentChild && (
            <span className="text-blue-400">
              Searched: child → Returns: parent
            </span>
          )}
        </div>

        {/* Metric cards */}
        {stats && (
          <div className="flex gap-3">
            {[
              { label: "chunks", value: stats.total.toLocaleString() },
              { label: "avg size", value: `${stats.avg}` },
              { label: "min/max", value: `${stats.min}\u2013${stats.max}` },
              { label: "overlap", value: `${stats.overlapPct}%` },
            ].map((card) => (
              <div
                key={card.label}
                className="flex-1 bg-bg-elevated/50 rounded px-2 py-1 text-center"
              >
                <div className="text-sm text-text font-medium">
                  {card.value}
                </div>
                <div className="text-[10px] text-text-dim">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Histogram toggle */}
        {stats && (
          <button
            onClick={() => setShowHistogram(!showHistogram)}
            className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
          >
            {showHistogram ? "\u25B2 Hide" : "\u25BC Show"} distribution
          </button>
        )}

        {/* Histogram */}
        {showHistogram && stats && (
          <div className="space-y-0.5 pt-1">
            {stats.sortedBuckets.map(([bucket, count]) => (
              <div
                key={bucket}
                className="flex items-center gap-2 text-[10px]"
              >
                <span className="w-16 text-right text-text-dim">
                  {bucket}\u2013{bucket + 100}
                </span>
                <div className="flex-1 h-3 bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent/40 rounded"
                    style={{
                      width: `${(count / stats.maxCount) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-8 text-text-dim">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IndexTab({ retriever, onStartIndexing }: IndexTabProps) {
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(
    null,
  );
  const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(
    null,
  );

  const isReady = retriever.status === "ready";
  const isIndexing = retriever.status === "indexing";

  // ---------------------------------------------------------------------------
  // Lifted chunk loading (shared by StatsBanner, DocumentViewer, ChunkList, ChunkDetail)
  // ---------------------------------------------------------------------------

  const [allChunks, setAllChunks] = useState<Chunk[]>([]);
  const [chunkCursor, setChunkCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  const firstPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    isReady && selectedDocId
      ? {
          kbId: retriever.kbId,
          indexConfigHash: retriever.indexConfigHash,
          documentId: selectedDocId,
          cursor: null,
          pageSize: 100,
        }
      : "skip",
  );

  // Reset when document changes
  useEffect(() => {
    setAllChunks([]);
    setChunkCursor(null);
    setPagesLoaded(0);
    setLoadingMore(false);
    setSelectedChunkIndex(null);
  }, [selectedDocId, retriever.indexConfigHash]);

  // Ingest first page
  useEffect(() => {
    if (firstPage && pagesLoaded === 0) {
      setAllChunks(firstPage.chunks as Chunk[]);
      setChunkCursor(firstPage.isDone ? null : firstPage.continueCursor);
      setPagesLoaded(1);
      if (!firstPage.isDone) setLoadingMore(true);
    }
  }, [firstPage, pagesLoaded]);

  // Auto-load subsequent pages
  const nextPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    loadingMore && chunkCursor
      ? {
          kbId: retriever.kbId,
          indexConfigHash: retriever.indexConfigHash,
          documentId: selectedDocId!,
          cursor: chunkCursor,
          pageSize: 100,
        }
      : "skip",
  );

  useEffect(() => {
    if (nextPage && loadingMore) {
      setAllChunks((prev) => [...prev, ...(nextPage.chunks as Chunk[])]);
      const nextCur = nextPage.isDone ? null : nextPage.continueCursor;
      setChunkCursor(nextCur);
      setPagesLoaded((p) => p + 1);
      setLoadingMore(false);
      if (!nextPage.isDone) setLoadingMore(true);
    }
  }, [nextPage, loadingMore]);

  const sortedChunks = useMemo(
    () => [...allChunks].sort((a, b) => a.start - b.start),
    [allChunks],
  );

  const chunksStillLoading = isReady && selectedDocId != null && (firstPage === undefined || loadingMore);

  // ---------------------------------------------------------------------------
  // Lifted document content (shared by DocumentViewer + ChunkDetailPanel)
  // ---------------------------------------------------------------------------

  const docContent = useQuery(
    api.crud.documents.getContent,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // ---------------------------------------------------------------------------
  // Chunk navigation callbacks
  // ---------------------------------------------------------------------------

  const handlePrevChunk = useCallback(() => {
    setSelectedChunkIndex((prev) =>
      prev !== null && prev > 0 ? prev - 1 : prev,
    );
  }, []);

  const handleNextChunk = useCallback(() => {
    setSelectedChunkIndex((prev) =>
      prev !== null && prev < sortedChunks.length - 1 ? prev + 1 : prev,
    );
  }, [sortedChunks.length]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedChunk =
    selectedChunkIndex !== null && selectedChunkIndex < sortedChunks.length
      ? sortedChunks[selectedChunkIndex]
      : null;

  return (
    <div className="flex flex-col h-full border-t border-border">
      <StatsBanner
        retrieverConfig={retriever.retrieverConfig}
        chunks={sortedChunks}
        chunkCount={retriever.chunkCount}
      />
      <div className="flex flex-1 min-h-0">
        {/* Left: Document list */}
        <div className="w-[200px] flex-shrink-0 border-r border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elevated/50">
            <span className="text-[11px] text-text-muted font-medium">
              Documents
            </span>
          </div>
          <DocumentListPanel
            kbId={retriever.kbId}
            selectedDocId={selectedDocId}
            onSelect={setSelectedDocId}
          />
        </div>

        {/* Center: Document viewer */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedDocId ? (
            <DocumentViewerPanel
              docContent={docContent}
              chunks={sortedChunks}
              chunksLoading={chunksStillLoading}
              selectedChunkIndex={selectedChunkIndex}
              onSelectChunk={setSelectedChunkIndex}
              isReady={isReady}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-dim">
              Select a document to view its content.
            </div>
          )}
        </div>

        {/* Right: Chunk inspector OR Start Indexing panel */}
        <div className="w-[300px] flex-shrink-0 border-l border-border overflow-hidden">
          {!isReady ? (
            <IndexingActionPanel
              status={retriever.status}
              isIndexing={isIndexing}
              chunkCount={retriever.chunkCount}
              onStartIndexing={onStartIndexing}
            />
          ) : selectedDocId && sortedChunks.length > 0 ? (
            <div className="h-full flex flex-col">
              <ChunkListPanel
                chunks={sortedChunks}
                selectedIndex={selectedChunkIndex}
                onSelect={setSelectedChunkIndex}
              />
              {selectedChunk && docContent ? (
                <ChunkDetailPanel
                  chunk={selectedChunk}
                  index={selectedChunkIndex!}
                  total={sortedChunks.length}
                  documentContent={docContent.content}
                  onPrev={handlePrevChunk}
                  onNext={handleNextChunk}
                />
              ) : (
                <div className="h-1/2 flex items-center justify-center text-xs text-text-dim px-4 text-center">
                  Click anywhere in the document to inspect a chunk.
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-dim px-4 text-center">
              {selectedDocId
                ? chunksStillLoading
                  ? "Loading chunks..."
                  : "No chunks found for this document."
                : "Select a document and click in the text to inspect a chunk."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indexing Action Panel (right side for non-ready retrievers)
// ---------------------------------------------------------------------------

function IndexingActionPanel({
  status,
  isIndexing,
  chunkCount,
  onStartIndexing,
}: {
  status: string;
  isIndexing: boolean;
  chunkCount?: number;
  onStartIndexing: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <span className="text-[11px] text-text-muted font-medium">
          {isIndexing ? "Indexing in Progress" : "Indexing"}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          {isIndexing ? (
            <>
              <div className="flex justify-center">
                <Spinner className="w-6 h-6" />
              </div>
              <p className="text-sm text-text-muted">Indexing documents...</p>
              {chunkCount != null && chunkCount > 0 && (
                <p className="text-[11px] text-accent">
                  {chunkCount} chunk{chunkCount !== 1 ? "s" : ""} created so far
                </p>
              )}
              <p className="text-[10px] text-text-dim">
                Chunks will appear once indexing completes. You can browse
                documents on the left while indexing runs.
              </p>
            </>
          ) : status === "error" ? (
            <>
              <div className="w-8 h-8 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
                <span className="text-red-400 text-lg">!</span>
              </div>
              <p className="text-sm text-text-muted">
                Indexing failed. You can retry.
              </p>
              <button
                type="button"
                onClick={onStartIndexing}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated transition-colors cursor-pointer"
              >
                Retry Indexing
              </button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </div>
              <p className="text-sm text-text-muted">
                This retriever hasn&apos;t been indexed yet.
              </p>
              <p className="text-[10px] text-text-dim leading-relaxed">
                Start indexing to chunk documents and generate embeddings. You
                can browse documents on the left in the meantime.
              </p>
              <button
                type="button"
                onClick={onStartIndexing}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated transition-colors cursor-pointer"
              >
                Start Indexing
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

