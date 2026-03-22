"use client";

import { Suspense, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useKbFromUrl } from "@/lib/useKbFromUrl";
import { FileUploader } from "@/components/FileUploader";
import { CreateKBModal } from "@/components/CreateKBModal";
import { ImportUrlModal } from "@/components/ImportUrlModal";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { INDUSTRIES } from "@/lib/constants";

export default function KBPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="kb" /></div>}>
      <KBPageContent />
    </Suspense>
  );
}

function KBPageContent() {
  // --- KB selection ---
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();
  const [industryFilter, setIndustryFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // --- Document state ---
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docViewMode, setDocViewMode] = useState<"raw" | "rendered">("rendered");

  // --- Crawl state ---
  const [showImportModal, setShowImportModal] = useState(false);
  const [crawlJobId, setCrawlJobId] = useState<Id<"crawlJobs"> | null>(null);

  // --- Queries ---
  const kbs = useQuery(
    api.crud.knowledgeBases.listWithDocCounts,
    industryFilter ? { industry: industryFilter } : {},
  );
  const documents = useQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const selectedDoc = useQuery(
    api.crud.documents.get,
    selectedDocId ? { id: selectedDocId } : "skip",
  );
  const crawlJob = useQuery(
    api.scraping.orchestration.getJob,
    crawlJobId ? { jobId: crawlJobId } : "skip",
  );

  // --- Mutations ---
  const removeDoc = useMutation(api.crud.documents.remove);
  const cancelCrawl = useMutation(api.scraping.orchestration.cancelCrawl);

  // --- Derived ---
  const selectedKb = kbs?.find((kb) => kb._id === selectedKbId);
  const filteredDocs = documents?.filter(
    (doc) =>
      !docSearchQuery ||
      doc.title.toLowerCase().includes(docSearchQuery.toLowerCase()),
  );

  // Reset doc selection when KB changes
  useEffect(() => {
    setSelectedDocId(null);
    setDocSearchQuery("");
    setCrawlJobId(null);
  }, [selectedKbId]);

  // --- Handlers ---
  async function handleDeleteDoc(docId: Id<"documents">) {
    try {
      await removeDoc({ id: docId });
      if (selectedDocId === docId) {
        setSelectedDocId(null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }

  function handleKBCreated(kbId: Id<"knowledgeBases">) {
    setShowCreateModal(false);
    setSelectedKbId(kbId);
  }

  return (
    <div className="flex flex-col h-screen">
      <Header mode="kb" kbId={selectedKbId} />

      {/* ── KB Selection & Metadata Bar ── */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3 space-y-2">
        {/* Row 1: KB dropdown, industry filter, create button */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              KB
            </label>
            {kbs === undefined ? (
              <div className="flex items-center gap-2 text-text-dim text-sm">
                <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                Loading...
              </div>
            ) : (
              <select
                value={selectedKbId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedKbId(e.target.value as Id<"knowledgeBases">);
                  }
                }}
                className="flex-1 max-w-xs bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
              >
                <option value="">Select a knowledge base...</option>
                {kbs.map((kb) => (
                  <option key={kb._id} value={kb._id}>
                    {kb.name} ({kb.documentCount}{" "}
                    {kb.documentCount === 1 ? "doc" : "docs"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              Industry
            </label>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
            >
              <option value="">All</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind.charAt(0).toUpperCase() + ind.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
          >
            + Create KB
          </button>
        </div>

        {/* Row 2: Metadata line */}
        {selectedKb && (
          <div className="flex items-center gap-3 text-xs text-text-dim">
            {selectedKb.company && <span>Company: {selectedKb.company}</span>}
            {selectedKb.company && selectedKb.entityType && (
              <span className="text-border">|</span>
            )}
            {selectedKb.entityType && (
              <span>Entity: {selectedKb.entityType}</span>
            )}
            {(selectedKb.company || selectedKb.entityType) && (
              <span className="text-border">|</span>
            )}
            <span>
              {selectedKb.documentCount} document
              {selectedKb.documentCount !== 1 ? "s" : ""}
            </span>
            {selectedKb.sourceUrl && (
              <>
                <span className="text-border">|</span>
                <a
                  href={selectedKb.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent/80 transition-colors"
                >
                  {selectedKb.sourceUrl}
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Master-Detail Split ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Document Panel (left, ~30%) */}
        <div className="w-[360px] border-r border-border flex flex-col bg-bg-elevated">
          {selectedKbId ? (
            <>
              {/* Search */}
              <div className="p-3 border-b border-border">
                <input
                  type="text"
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
                />
              </div>

              {/* Upload + Import */}
              <div className="p-3 border-b border-border space-y-2">
                <FileUploader kbId={selectedKbId} />
                <button
                  onClick={() => setShowImportModal(true)}
                  className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
                >
                  Import from URL
                </button>

                {/* Crawl progress */}
                {crawlJob && (
                  <div className="text-xs space-y-1">
                    {crawlJob.status === "running" && (
                      <div className="flex items-center justify-between">
                        <span className="text-text-dim">
                          Crawling... {crawlJob.stats.scraped}/
                          {crawlJob.stats.discovered} pages
                        </span>
                        <button
                          onClick={() => cancelCrawl({ jobId: crawlJobId! })}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {crawlJob.status === "completed" && (
                      <span className="text-accent">
                        Done: {crawlJob.stats.scraped} pages
                      </span>
                    )}
                    {crawlJob.status === "completed_with_errors" && (
                      <span className="text-yellow-400">
                        Done: {crawlJob.stats.scraped} scraped,{" "}
                        {crawlJob.stats.failed} failed
                      </span>
                    )}
                    {crawlJob.status === "failed" && (
                      <span className="text-red-400">
                        Failed: {crawlJob.error || "Unknown"}
                      </span>
                    )}
                    {crawlJob.status === "cancelled" && (
                      <span className="text-text-dim">
                        Cancelled: {crawlJob.stats.scraped} pages
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Document list (scrollable) */}
              <div className="flex-1 overflow-y-auto">
                {documents === undefined ? (
                  <div className="p-4 flex items-center gap-2 text-text-dim text-xs">
                    <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Loading...
                  </div>
                ) : filteredDocs && filteredDocs.length > 0 ? (
                  filteredDocs.map((doc) => (
                    <div
                      key={doc._id}
                      onClick={() => setSelectedDocId(doc._id)}
                      className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                        selectedDocId === doc._id
                          ? "bg-accent/10 border-l-2 border-l-accent"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-text truncate">
                          {doc.title}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                          <span>
                            {(doc.contentLength / 1024).toFixed(1)}k
                          </span>
                          {doc.sourceType && (
                            <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px]">
                              {doc.sourceType}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDoc(doc._id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
                        title="Delete document"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-xs text-text-dim">
                    {docSearchQuery
                      ? "No matching documents."
                      : "No documents yet. Upload files or import from URL."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-4 text-xs text-text-dim">
              Select a knowledge base to manage its documents.
            </div>
          )}
        </div>

        {/* Content Viewer (right, ~70%) */}
        <div className="flex-1 overflow-hidden flex flex-col bg-bg">
          {selectedDoc ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated/50">
                <span className="text-xs text-accent font-medium">
                  {selectedDoc.title}
                </span>
                <div className="flex items-center gap-3 text-[10px] text-text-dim">
                  <span>
                    {(selectedDoc.contentLength / 1024).toFixed(1)}k
                  </span>
                  {selectedDoc.sourceType && (
                    <span className="text-accent">
                      {selectedDoc.sourceType}
                    </span>
                  )}
                  {/* Raw/Rendered toggle */}
                  <div className="flex items-center bg-bg-surface rounded-full p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDocViewMode("raw")}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                        docViewMode === "raw"
                          ? "bg-accent/20 text-accent"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      raw
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocViewMode("rendered")}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                        docViewMode === "rendered"
                          ? "bg-accent/20 text-accent"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      rendered
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {docViewMode === "raw" ? (
                  <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-all font-[inherit]">
                    {selectedDoc.content}
                  </pre>
                ) : (
                  <MarkdownViewer
                    content={selectedDoc.content}
                    showToggle={false}
                    defaultMode="rendered"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
              Select a document to view its content
            </div>
          )}
        </div>
      </div>

      {/* Create KB Modal */}
      <CreateKBModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleKBCreated}
      />

      {/* Import URL Modal */}
      {selectedKbId && (
        <ImportUrlModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          kbId={selectedKbId}
          defaultUrl={selectedKb?.sourceUrl}
          onStarted={(jobId) => setCrawlJobId(jobId)}
        />
      )}
    </div>
  );
}
