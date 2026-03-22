"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { loadImportUrlConfig, saveImportUrlConfig } from "@/lib/constants";

interface ImportUrlModalProps {
  open: boolean;
  onClose: () => void;
  kbId: Id<"knowledgeBases">;
  defaultUrl?: string; // pre-populated from KB's sourceUrl
  onStarted: (jobId: Id<"crawlJobs">) => void;
}

export function ImportUrlModal({
  open,
  onClose,
  kbId,
  defaultUrl,
  onStarted,
}: ImportUrlModalProps) {
  const startCrawl = useMutation(api.scraping.orchestration.startCrawl);

  // Primary fields
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [includePaths, setIncludePaths] = useState("");
  const [excludePaths, setExcludePaths] = useState("");

  // Advanced fields
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxDepth, setMaxDepth] = useState(3);
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [delay, setDelay] = useState(0);

  const [starting, setStarting] = useState(false);

  // Pre-populate on open
  useEffect(() => {
    if (!open) return;
    setUrl(defaultUrl || "");
    setStarting(false);
    setShowAdvanced(false);

    const saved = loadImportUrlConfig();
    if (saved) {
      setMaxPages(saved.maxPages);
      setIncludePaths(saved.includePaths.join(", "));
      setExcludePaths(saved.excludePaths.join(", "));
      setMaxDepth(saved.maxDepth);
      setAllowSubdomains(saved.allowSubdomains);
      setConcurrency(saved.concurrency);
      setDelay(saved.delay);
    } else {
      setMaxPages(200);
      setIncludePaths("");
      setExcludePaths("");
      setMaxDepth(3);
      setAllowSubdomains(false);
      setConcurrency(3);
      setDelay(0);
    }
  }, [open, defaultUrl]);

  if (!open) return null;

  function parsePatterns(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleStart() {
    if (!url.trim() || starting) return;
    setStarting(true);
    try {
      const includeArr = parsePatterns(includePaths);
      const excludeArr = parsePatterns(excludePaths);

      const jobId = await startCrawl({
        kbId,
        startUrl: url.trim(),
        config: {
          maxPages: Math.min(Math.max(maxPages, 1), 1000),
          maxDepth,
          includePaths: includeArr.length ? includeArr : undefined,
          excludePaths: excludeArr.length ? excludeArr : undefined,
          allowSubdomains,
          concurrency: Math.min(Math.max(concurrency, 1), 10),
          delay: Math.max(delay, 0),
        },
      });

      saveImportUrlConfig({
        maxPages,
        includePaths: includeArr,
        excludePaths: excludeArr,
        maxDepth,
        allowSubdomains,
        concurrency,
        delay,
      });

      onStarted(jobId);
      onClose();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">Import from URL</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Start URL */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Start URL *</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/docs"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            autoFocus
          />
        </div>

        {/* Max Pages */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Max Pages <span className="normal-case text-text-dim">(1–1000)</span>
          </label>
          <input
            type="number"
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            min={1}
            max={1000}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
        </div>

        {/* Include / Exclude patterns */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Include Paths</label>
            <input
              type="text"
              value={includePaths}
              onChange={(e) => setIncludePaths(e.target.value)}
              placeholder="/docs/**, /help/**"
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">Exclude Paths</label>
            <input
              type="text"
              value={excludePaths}
              onChange={(e) => setExcludePaths(e.target.value)}
              placeholder="/blog/**, /changelog/**"
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            />
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-text-dim hover:text-accent transition-colors"
        >
          {showAdvanced ? "Hide Advanced" : "Advanced Options"}
        </button>

        {showAdvanced && (
          <div className="space-y-3 pl-2 border-l-2 border-border">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">Max Depth</label>
                <input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">
                  Concurrency <span className="normal-case text-text-dim">(1–10)</span>
                </label>
                <input
                  type="number"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted uppercase tracking-wide">Delay (ms)</label>
                <input
                  type="number"
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  min={0}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="allowSubdomains"
                  checked={allowSubdomains}
                  onChange={(e) => setAllowSubdomains(e.target.checked)}
                  className="accent-accent"
                />
                <label htmlFor="allowSubdomains" className="text-xs text-text-dim">
                  Allow subdomains
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border" />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-dim hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!url.trim() || starting}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {starting ? "Starting..." : "Start Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
