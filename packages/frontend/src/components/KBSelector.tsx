"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { FileUploader } from "./FileUploader";

interface KBSelectorProps {
  selectedKbId: Id<"knowledgeBases"> | null;
  onSelect: (kbId: Id<"knowledgeBases">) => void;
}

const INDUSTRIES = [
  "finance",
  "insurance",
  "healthcare",
  "telecom",
  "education",
  "government",
] as const;

const ENTITY_TYPES = [
  "company",
  "government-state",
  "government-county",
  "industry-aggregate",
] as const;

export function KBSelector({ selectedKbId, onSelect }: KBSelectorProps) {
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const kbs = useQuery(
    api.crud.knowledgeBases.listByIndustry,
    industryFilter ? { industry: industryFilter } : {},
  );
  const documents = useQuery(
    api.crud.documents.listByKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const createKb = useMutation(api.crud.knowledgeBases.create);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newEntityType, setNewEntityType] = useState("");
  const [creating, setCreating] = useState(false);

  // Crawl import state
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlJobId, setCrawlJobId] = useState<Id<"crawlJobs"> | null>(null);
  const [crawling, setCrawling] = useState(false);
  const startCrawl = useMutation(api.scraping.orchestration.startCrawl);
  const cancelCrawl = useMutation(api.scraping.orchestration.cancelCrawl);
  const crawlJob = useQuery(
    api.scraping.orchestration.getJob,
    crawlJobId ? { jobId: crawlJobId } : "skip",
  );

  async function handleStartCrawl() {
    if (!crawlUrl.trim() || !selectedKbId || crawling) return;
    setCrawling(true);
    try {
      const jobId = await startCrawl({
        kbId: selectedKbId,
        startUrl: crawlUrl.trim(),
      });
      setCrawlJobId(jobId);
      setCrawlUrl("");
    } finally {
      setCrawling(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createKb({
        name: newName.trim(),
        ...(newIndustry && { industry: newIndustry }),
        ...(newCompany.trim() && { company: newCompany.trim() }),
        ...(newEntityType && { entityType: newEntityType }),
      });
      onSelect(id);
      setNewName("");
      setNewIndustry("");
      setNewCompany("");
      setNewEntityType("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-text-muted uppercase tracking-wide">
          Industry Filter
        </label>
        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        >
          <option value="">All Industries</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind} value={ind}>
              {ind.charAt(0).toUpperCase() + ind.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-text-muted uppercase tracking-wide">
          Knowledge Base
        </label>

        {kbs === undefined ? (
          <div className="flex items-center gap-2 text-text-dim text-sm">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedKbId ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  onSelect(e.target.value as Id<"knowledgeBases">);
                }
              }}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
            >
              <option value="">Select a knowledge base...</option>
              {kbs.map((kb) => (
                <option key={kb._id} value={kb._id}>
                  {kb.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowCreate(!showCreate)}
              className="text-xs text-text-dim hover:text-accent transition-colors"
            >
              + Create new
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="border border-border rounded bg-bg-elevated p-3 space-y-2 animate-fade-in">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Knowledge base name..."
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <select
            value={newIndustry}
            onChange={(e) => setNewIndustry(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text-dim focus:border-accent outline-none"
          >
            <option value="">Industry (optional)</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind.charAt(0).toUpperCase() + ind.slice(1)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
            placeholder="Company (optional)"
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
          />
          <select
            value={newEntityType}
            onChange={(e) => setNewEntityType(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text-dim focus:border-accent outline-none"
          >
            <option value="">Entity type (optional)</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-3 py-1 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1 text-xs text-text-dim hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedKbId && (
        <div className="space-y-3">
          <FileUploader kbId={selectedKbId} />

          <div className="space-y-2">
            <label className="text-xs text-text-muted uppercase tracking-wide">
              Import from URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                placeholder="https://example.com/support"
                className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
                disabled={crawling}
              />
              <button
                onClick={handleStartCrawl}
                disabled={!crawlUrl.trim() || crawling}
                className="px-3 py-1 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {crawling ? "Starting..." : "Start Crawl"}
              </button>
            </div>
            {crawlJob && (
              <div className="border border-border rounded bg-bg-elevated p-2 space-y-1 text-xs">
                {crawlJob.status === "running" && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-dim">
                      Scraping... {crawlJob.stats.scraped}/{crawlJob.stats.discovered} pages
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
                    Completed: {crawlJob.stats.scraped} pages scraped
                  </span>
                )}
                {crawlJob.status === "completed_with_errors" && (
                  <span className="text-yellow-400">
                    Completed with errors: {crawlJob.stats.scraped} scraped, {crawlJob.stats.failed} failed
                  </span>
                )}
                {crawlJob.status === "failed" && (
                  <span className="text-red-400">
                    Failed: {crawlJob.error || "Unknown error"}
                  </span>
                )}
                {crawlJob.status === "cancelled" && (
                  <span className="text-text-dim">
                    Cancelled: {crawlJob.stats.scraped} pages scraped
                  </span>
                )}
              </div>
            )}
          </div>

          {documents === undefined ? (
            <div className="flex items-center gap-2 text-text-dim text-xs">
              <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Loading documents...
            </div>
          ) : documents.length > 0 ? (
            <div className="border border-border rounded bg-bg-elevated">
              <div className="px-3 py-1.5 border-b border-border text-xs text-text-dim uppercase tracking-wide">
                Documents ({documents.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
                {documents.map((doc) => (
                  <div
                    key={doc._id}
                    className="px-3 py-1.5 text-xs text-text border-b border-border/50 last:border-0 flex justify-between"
                  >
                    <span className="truncate">{doc.title}</span>
                    <span className="text-text-dim flex-shrink-0 ml-2">
                      {(doc.contentLength / 1024).toFixed(1)}k
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-dim">
              No documents yet. Upload files or import from URL above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
