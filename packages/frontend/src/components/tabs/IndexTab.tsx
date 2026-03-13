"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { useState, useEffect, useMemo, useCallback } from "react";

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

/** A contiguous segment of document text with styling metadata. */
interface Segment {
  text: string;
  chunkIndex: number | null; // null = uncovered gap
  isOverlap: boolean;
}

// ---------------------------------------------------------------------------
// Segment builder
// ---------------------------------------------------------------------------

/**
 * Build an array of styled segments from sorted chunks.
 *
 * The algorithm walks through the chunks in start-offset order, emitting
 * segments for gaps (uncovered text), normal chunk regions, and overlap
 * regions where two adjacent chunks share characters.
 */
function buildSegments(content: string, chunks: Chunk[]): Segment[] {
  if (chunks.length === 0) {
    return [{ text: content, chunkIndex: null, isOverlap: false }];
  }

  const segments: Segment[] = [];
  let cursor = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const start = Math.max(0, chunk.start);
    const end = Math.min(content.length, chunk.end);

    // Gap before this chunk
    if (start > cursor) {
      segments.push({
        text: content.slice(cursor, start),
        chunkIndex: null,
        isOverlap: false,
      });
    }

    // Check overlap with the next chunk
    const nextChunk = i + 1 < chunks.length ? chunks[i + 1] : null;
    const overlapStart = nextChunk ? Math.max(0, nextChunk.start) : end;
    const overlapEnd = nextChunk
      ? Math.min(end, Math.min(content.length, nextChunk.end))
      : end;
    const hasOverlap = nextChunk !== null && overlapStart < end;

    if (hasOverlap) {
      // Non-overlapping part of this chunk
      if (overlapStart > Math.max(start, cursor)) {
        segments.push({
          text: content.slice(Math.max(start, cursor), overlapStart),
          chunkIndex: i,
          isOverlap: false,
        });
      }
      // Overlapping part
      if (overlapEnd > overlapStart) {
        segments.push({
          text: content.slice(overlapStart, overlapEnd),
          chunkIndex: i,
          isOverlap: true,
        });
      }
      // Remainder of this chunk after overlap
      if (end > overlapEnd) {
        segments.push({
          text: content.slice(overlapEnd, end),
          chunkIndex: i,
          isOverlap: false,
        });
      }
    } else {
      // No overlap - emit the whole chunk
      const segStart = Math.max(start, cursor);
      if (end > segStart) {
        segments.push({
          text: content.slice(segStart, end),
          chunkIndex: i,
          isOverlap: false,
        });
      }
    }

    cursor = Math.max(cursor, end);
  }

  // Trailing text after all chunks
  if (cursor < content.length) {
    segments.push({
      text: content.slice(cursor),
      chunkIndex: null,
      isOverlap: false,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Diff detection
// ---------------------------------------------------------------------------

type DiffKind =
  | { type: "match" }
  | { type: "contextual_prefix"; prefixLength: number }
  | { type: "summary_replacement" };

function detectDiff(original: string, indexed: string): DiffKind {
  if (original === indexed) {
    return { type: "match" };
  }
  // Check if indexed content ends with the original (contextual prefix)
  if (indexed.endsWith(original)) {
    return {
      type: "contextual_prefix",
      prefixLength: indexed.length - original.length,
    };
  }
  // Check if indexed content contains the original somewhere
  const idx = indexed.indexOf(original);
  if (idx > 0) {
    return { type: "contextual_prefix", prefixLength: idx };
  }
  return { type: "summary_replacement" };
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

/** Numbered pill inserted at a chunk boundary. */
function ChunkPill({
  index,
  isSelected,
  onClick,
}: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inline-block px-1 rounded font-mono text-[9px] cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/40 text-accent-bright ring-1 ring-accent/50"
          : "bg-accent/20 text-accent hover:bg-accent/30"
      }`}
    >
      [{index + 1}]
    </span>
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
  const docs = useQuery(api.crud.documents.listByKb, { kbId });

  if (docs === undefined) {
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Viewer Panel (center)
// ---------------------------------------------------------------------------

function DocumentViewerPanel({
  kbId,
  indexConfigHash,
  documentId,
  selectedChunkIndex,
  onSelectChunk,
  isReady,
}: {
  kbId: Id<"knowledgeBases">;
  indexConfigHash: string;
  documentId: Id<"documents">;
  selectedChunkIndex: number | null;
  onSelectChunk: (index: number) => void;
  /** Whether the retriever has been indexed (chunks exist). */
  isReady: boolean;
}) {
  const [viewMode, setViewMode] = useState<"raw" | "rendered">(
    isReady ? "raw" : "rendered",
  );

  // Load document content
  const docContent = useQuery(api.crud.documents.getContent, {
    id: documentId,
  });

  // Load first page of chunks (skip when not ready)
  const [allChunks, setAllChunks] = useState<Chunk[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  const firstPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    isReady
      ? {
          kbId,
          indexConfigHash,
          documentId,
          cursor: null,
          pageSize: 100,
        }
      : "skip",
  );

  // Reset when document changes
  useEffect(() => {
    setAllChunks([]);
    setCursor(null);
    setPagesLoaded(0);
    setLoadingMore(false);
  }, [documentId, indexConfigHash]);

  // Ingest first page
  useEffect(() => {
    if (firstPage && pagesLoaded === 0) {
      setAllChunks(firstPage.chunks as Chunk[]);
      setCursor(firstPage.isDone ? null : firstPage.continueCursor);
      setPagesLoaded(1);
    }
  }, [firstPage, pagesLoaded]);

  // Subsequent pages via separate query (only active when loading more)
  const nextPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    loadingMore && cursor
      ? { kbId, indexConfigHash, documentId, cursor, pageSize: 100 }
      : "skip",
  );

  useEffect(() => {
    if (nextPage && loadingMore) {
      setAllChunks((prev) => [...prev, ...(nextPage.chunks as Chunk[])]);
      setCursor(nextPage.isDone ? null : nextPage.continueCursor);
      setPagesLoaded((p) => p + 1);
      setLoadingMore(false);
    }
  }, [nextPage, loadingMore]);

  const handleLoadMore = useCallback(() => {
    if (cursor && !loadingMore) {
      setLoadingMore(true);
    }
  }, [cursor, loadingMore]);

  // Sort chunks by start offset
  const sortedChunks = useMemo(
    () => [...allChunks].sort((a, b) => a.start - b.start),
    [allChunks],
  );

  // Build segments for rendering
  const segments = useMemo(() => {
    if (!docContent) return [];
    return buildSegments(docContent.content, sortedChunks);
  }, [docContent, sortedChunks]);

  if (docContent === undefined || (isReady && firstPage === undefined)) {
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

  const hasMore = cursor !== null;
  const hasChunks = sortedChunks.length > 0;

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
              {sortedChunks.length} chunk{sortedChunks.length !== 1 ? "s" : ""}
              {hasMore ? "+" : ""}
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
          <>
            <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-words font-mono max-w-full">
              {hasChunks
                ? renderAnnotatedContent(
                    segments,
                    sortedChunks,
                    selectedChunkIndex,
                    onSelectChunk,
                  )
                : docContent.content}
            </pre>

            {/* Load More */}
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-[11px] px-3 py-1.5 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner className="w-3 h-3" /> Loading...
                    </span>
                  ) : (
                    "Load More Chunks"
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <MarkdownViewer
              content={docContent.content}
              showToggle={false}
              defaultMode="rendered"
            />
            {hasChunks && (
              <p className="mt-2 text-[10px] text-text-dim italic">
                Switch to raw mode to see chunk boundary annotations.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Render the document content with chunk annotation styling.
 * Inserts numbered pills at chunk boundaries and applies zebra striping.
 */
function renderAnnotatedContent(
  segments: Segment[],
  sortedChunks: Chunk[],
  selectedChunkIndex: number | null,
  onSelectChunk: (index: number) => void,
): React.ReactNode[] {
  if (segments.length === 0) return [];

  const elements: React.ReactNode[] = [];
  // Track which chunk indices have already had their pill inserted
  const pillsInserted = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // Insert a pill at the start of a new chunk
    if (seg.chunkIndex !== null && !pillsInserted.has(seg.chunkIndex)) {
      pillsInserted.add(seg.chunkIndex);
      elements.push(
        <ChunkPill
          key={`pill-${seg.chunkIndex}`}
          index={seg.chunkIndex}
          isSelected={selectedChunkIndex === seg.chunkIndex}
          onClick={() => onSelectChunk(seg.chunkIndex!)}
        />,
      );
    }

    // Style the segment
    let bgClass = "";
    if (seg.isOverlap) {
      bgClass = "bg-yellow-500/10";
    } else if (seg.chunkIndex !== null) {
      bgClass = seg.chunkIndex % 2 === 0 ? "bg-accent/5" : "bg-accent/[0.02]";
    }

    const isInSelectedChunk = seg.chunkIndex === selectedChunkIndex;

    elements.push(
      <span
        key={`seg-${i}`}
        className={`${bgClass} ${isInSelectedChunk ? "ring-1 ring-accent/30 rounded-sm" : ""}`}
      >
        {seg.text}
      </span>,
    );
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Chunk Inspector Panel (right)
// ---------------------------------------------------------------------------

function ChunkInspectorPanel({
  chunks,
  documentContent,
  selectedChunkIndex,
  onSelectChunk,
}: {
  chunks: Chunk[];
  documentContent: string;
  selectedChunkIndex: number | null;
  onSelectChunk: (index: number) => void;
}) {
  const [showList, setShowList] = useState(false);

  if (showList) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
          <span className="text-[11px] text-text-muted font-medium">
            All Chunks ({chunks.length})
          </span>
          <button
            type="button"
            onClick={() => setShowList(false)}
            className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
          >
            Back
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {chunks.map((chunk, idx) => (
            <button
              key={chunk._id}
              type="button"
              onClick={() => {
                onSelectChunk(idx);
                setShowList(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
                idx === selectedChunkIndex
                  ? "bg-accent/10 text-accent"
                  : "text-text-dim hover:bg-bg-elevated"
              }`}
            >
              {chunk.chunkId}: {chunk.start}--{chunk.end}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selectedChunkIndex === null || selectedChunkIndex >= chunks.length) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
          <span className="text-[11px] text-text-muted font-medium">
            Chunk Inspector
          </span>
          {chunks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowList(true)}
              className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
            >
              List All
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-text-dim px-4 text-center">
          Click a numbered pill in the document to inspect a chunk.
        </div>
      </div>
    );
  }

  const chunk = chunks[selectedChunkIndex];
  const originalText = documentContent.slice(chunk.start, chunk.end);
  const diff = detectDiff(originalText, chunk.content);

  // Find overlaps with adjacent chunks
  const overlaps: string[] = [];
  if (selectedChunkIndex > 0) {
    const prev = chunks[selectedChunkIndex - 1];
    if (prev.end > chunk.start) {
      overlaps.push(
        `Overlaps ${prev.end - chunk.start} chars with chunk #${selectedChunkIndex}`,
      );
    }
  }
  if (selectedChunkIndex < chunks.length - 1) {
    const next = chunks[selectedChunkIndex + 1];
    if (chunk.end > next.start) {
      overlaps.push(
        `Overlaps ${chunk.end - next.start} chars with chunk #${selectedChunkIndex + 2}`,
      );
    }
  }

  const metaEntries = Object.entries(chunk.metadata ?? {});

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <span className="text-[11px] text-text-muted font-medium">
          Chunk #{selectedChunkIndex + 1}
        </span>
        <button
          type="button"
          onClick={() => setShowList(true)}
          className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
        >
          List All
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Chunk meta header */}
        <div className="px-3 py-2 border-b border-border/50 space-y-1">
          <p className="text-[10px] font-mono text-text-dim truncate">
            {chunk.chunkId}
          </p>
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span>
              Span: {chunk.start}--{chunk.end}
            </span>
            <span>{chunk.content.length} chars</span>
          </div>

          {/* Diff badge */}
          {diff.type === "match" && (
            <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
              Content matches source
            </span>
          )}
          {diff.type === "contextual_prefix" && (
            <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Contextual prefix detected (+{diff.prefixLength} chars)
            </span>
          )}
          {diff.type === "summary_replacement" && (
            <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              Summary replacement
            </span>
          )}

          {/* Overlap badges */}
          {overlaps.map((msg) => (
            <span
              key={msg}
              className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 ml-1"
            >
              {msg}
            </span>
          ))}
        </div>

        {/* Original text */}
        <div className="px-3 py-2 border-b border-border/50">
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">
            Original Text
          </p>
          <pre className="text-xs font-mono whitespace-pre-wrap text-text-muted max-h-48 overflow-y-auto bg-bg-surface rounded p-2">
            {originalText}
          </pre>
        </div>

        {/* Indexed content */}
        <div className="px-3 py-2 border-b border-border/50">
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">
            Indexed Content
          </p>
          {diff.type === "contextual_prefix" ? (
            <div className="max-h-64 overflow-y-auto bg-bg-surface rounded p-2">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                <span className="text-blue-400 bg-blue-500/10">
                  {chunk.content.slice(0, diff.prefixLength)}
                </span>
                <span className="text-text-muted">
                  {chunk.content.slice(diff.prefixLength)}
                </span>
              </pre>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <MarkdownViewer
                content={chunk.content}
                showToggle={true}
                defaultMode="raw"
                className="bg-bg-surface rounded"
              />
            </div>
          )}
        </div>

        {/* Metadata */}
        {metaEntries.length > 0 && (
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">
              Metadata
            </p>
            <div className="space-y-0.5">
              {metaEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline gap-2 text-[11px]"
                >
                  <span className="text-text-dim font-mono flex-shrink-0">
                    {key}:
                  </span>
                  <span className="text-text-muted truncate">
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            disabled={selectedChunkIndex === 0}
            onClick={() => onSelectChunk(selectedChunkIndex - 1)}
            className="text-[10px] px-2 py-1 rounded border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            Prev
          </button>
          <span className="text-[10px] text-text-dim">
            {selectedChunkIndex + 1} / {chunks.length}
          </span>
          <button
            type="button"
            disabled={selectedChunkIndex >= chunks.length - 1}
            onClick={() => onSelectChunk(selectedChunkIndex + 1)}
            className="text-[10px] px-2 py-1 rounded border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            Next
          </button>
        </div>
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

  // Reset chunk selection when document changes
  useEffect(() => {
    setSelectedChunkIndex(null);
  }, [selectedDocId]);

  const isReady = retriever.status === "ready";
  const isIndexing = retriever.status === "indexing";

  return (
    <div className="flex h-full border-t border-border">
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
            kbId={retriever.kbId}
            indexConfigHash={retriever.indexConfigHash}
            documentId={selectedDocId}
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
        ) : selectedDocId ? (
          <ChunkInspectorWrapper
            kbId={retriever.kbId}
            indexConfigHash={retriever.indexConfigHash}
            documentId={selectedDocId}
            selectedChunkIndex={selectedChunkIndex}
            onSelectChunk={setSelectedChunkIndex}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-text-dim px-4 text-center">
            Select a document and click a chunk pill to inspect.
          </div>
        )}
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

// ---------------------------------------------------------------------------
// Chunk Inspector Wrapper
// ---------------------------------------------------------------------------

/**
 * The inspector needs its own copy of chunks + doc content.
 * We re-query here since Convex deduplicates identical queries at the
 * transport level, so there is no extra network cost.
 */
function ChunkInspectorWrapper({
  kbId,
  indexConfigHash,
  documentId,
  selectedChunkIndex,
  onSelectChunk,
}: {
  kbId: Id<"knowledgeBases">;
  indexConfigHash: string;
  documentId: Id<"documents">;
  selectedChunkIndex: number | null;
  onSelectChunk: (index: number) => void;
}) {
  const docContent = useQuery(api.crud.documents.getContent, {
    id: documentId,
  });

  // Load chunks — same query the viewer uses; Convex deduplicates
  const [allChunks, setAllChunks] = useState<Chunk[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  const firstPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    {
      kbId,
      indexConfigHash,
      documentId,
      cursor: null,
      pageSize: 100,
    },
  );

  // Reset on document change
  useEffect(() => {
    setAllChunks([]);
    setCursor(null);
    setPagesLoaded(0);
    setLoadingMore(false);
  }, [documentId, indexConfigHash]);

  // Ingest first page
  useEffect(() => {
    if (firstPage && pagesLoaded === 0) {
      setAllChunks(firstPage.chunks as Chunk[]);
      setCursor(firstPage.isDone ? null : firstPage.continueCursor);
      setPagesLoaded(1);
    }
  }, [firstPage, pagesLoaded]);

  // Auto-load subsequent pages for the inspector (we want all chunks for navigation)
  const nextPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    loadingMore && cursor
      ? { kbId, indexConfigHash, documentId, cursor, pageSize: 100 }
      : "skip",
  );

  useEffect(() => {
    if (nextPage && loadingMore) {
      setAllChunks((prev) => [...prev, ...(nextPage.chunks as Chunk[])]);
      const nextCursor = nextPage.isDone ? null : nextPage.continueCursor;
      setCursor(nextCursor);
      setPagesLoaded((p) => p + 1);
      setLoadingMore(false);
      // Auto-load more if not done
      if (!nextPage.isDone) {
        setLoadingMore(true);
      }
    }
  }, [nextPage, loadingMore]);

  // Trigger auto-load after first page
  useEffect(() => {
    if (pagesLoaded === 1 && cursor) {
      setLoadingMore(true);
    }
  }, [pagesLoaded, cursor]);

  const sortedChunks = useMemo(
    () => [...allChunks].sort((a, b) => a.start - b.start),
    [allChunks],
  );

  if (!docContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <ChunkInspectorPanel
      chunks={sortedChunks}
      documentContent={docContent.content}
      selectedChunkIndex={selectedChunkIndex}
      onSelectChunk={onSelectChunk}
    />
  );
}
