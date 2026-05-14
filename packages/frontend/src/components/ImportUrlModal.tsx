"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { loadImportUrlConfig, saveImportUrlConfig } from "@/lib/constants";

interface ImportUrlModalProps {
  open: boolean;
  onClose: () => void;
  kbId: Id<"knowledgeBases">;
  defaultUrl?: string;
  onStarted: (jobId: Id<"crawlJobs">) => void;
}

type Tab = "crawl" | "paste";
type DiscoveryState =
  | { kind: "idle" }
  | { kind: "discovering" }
  | { kind: "found"; sitemapUrl: string; urls: string[] }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

const MAX_EXACT_URLS = 1000;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const DISCOVERY_DEBOUNCE_MS = 600;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:)\]]+$/g, "");
    try {
      const u = new URL(cleaned);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function ImportUrlModal({
  open,
  onClose,
  kbId,
  defaultUrl,
  onStarted,
}: ImportUrlModalProps) {
  const startCrawl = useMutation(api.scraping.orchestration.startCrawl);
  const discoverSitemap = useAction(api.scraping.sources.discoverSitemap);
  const categorizeUrls = useAction(api.scraping.categorize.categorizeUrls);

  const [tab, setTab] = useState<Tab>("crawl");
  const [url, setUrl] = useState("");

  // Crawl-mode BFS options
  const [maxPages, setMaxPages] = useState(200);
  const [includePaths, setIncludePaths] = useState("");
  const [excludePaths, setExcludePaths] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxDepth, setMaxDepth] = useState(3);
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [delay, setDelay] = useState(0);

  // Paste tab
  const [pasteText, setPasteText] = useState("");

  // Sitemap discovery (Crawl tab, implicit)
  const [discovery, setDiscovery] = useState<DiscoveryState>({ kind: "idle" });
  const discoveryReqIdRef = useRef(0);

  // Auto-categorize shared state
  const [topics, setTopics] = useState<Record<string, string> | null>(null);
  const [excludedTopics, setExcludedTopics] = useState<Set<string>>(new Set());
  const [categorizing, setCategorizing] = useState(false);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Reset on open ───
  useEffect(() => {
    if (!open) return;
    setTab("crawl");
    setUrl(defaultUrl || "");
    setStarting(false);
    setShowAdvanced(false);
    setError(null);
    setPasteText("");
    setDiscovery({ kind: "idle" });
    setTopics(null);
    setExcludedTopics(new Set());

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

  // ─── Implicit sitemap discovery in Crawl tab ───
  useEffect(() => {
    if (!open) return;
    if (tab !== "crawl") return;
    if (!isValidUrl(url)) {
      setDiscovery({ kind: "idle" });
      return;
    }
    const myId = ++discoveryReqIdRef.current;
    setDiscovery({ kind: "discovering" });
    const timer = setTimeout(async () => {
      try {
        const result = await discoverSitemap({ startUrl: url });
        if (myId !== discoveryReqIdRef.current) return;
        if (result && result.urls.length > 0) {
          setDiscovery({
            kind: "found",
            sitemapUrl: result.sitemapUrl,
            urls: result.urls,
          });
        } else {
          setDiscovery({ kind: "not-found" });
        }
      } catch (e: any) {
        if (myId !== discoveryReqIdRef.current) return;
        setDiscovery({
          kind: "error",
          message: e?.message ?? "Discovery failed",
        });
      }
    }, DISCOVERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, tab, url, discoverSitemap]);

  // ─── Derived URL list for paste/sitemap-style flows ───
  const pasteUrls = useMemo(() => extractUrls(pasteText), [pasteText]);
  const activeUrlsRaw = useMemo(() => {
    if (tab === "paste") return pasteUrls;
    if (tab === "crawl" && discovery.kind === "found") return discovery.urls;
    return [];
  }, [tab, pasteUrls, discovery]);
  const activeUrls = useMemo(
    () => activeUrlsRaw.slice(0, MAX_EXACT_URLS),
    [activeUrlsRaw],
  );
  const truncated = activeUrlsRaw.length > MAX_EXACT_URLS;

  // Wipe topics when the URL list identity changes.
  useEffect(() => {
    setTopics(null);
    setExcludedTopics(new Set());
  }, [
    tab,
    pasteText,
    discovery.kind === "found" ? discovery.sitemapUrl : null,
  ]);

  const topicGroups = useMemo(() => {
    if (!topics) return null;
    const groups = new Map<string, string[]>();
    for (const u of activeUrls) {
      const t = topics[u] ?? "Other";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(u);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [topics, activeUrls]);

  const finalUrls = useMemo(() => {
    if (!topics) return activeUrls;
    return activeUrls.filter((u) => {
      const t = topics[u] ?? "Other";
      return !excludedTopics.has(t);
    });
  }, [topics, activeUrls, excludedTopics]);

  // Whether the Crawl tab is in "use sitemap URLs" mode (exact fetch).
  const crawlExactList = tab === "crawl" && discovery.kind === "found";
  const crawlBfs = tab === "crawl" && discovery.kind !== "found";

  const canStart = (() => {
    if (starting) return false;
    if (tab === "crawl") {
      if (!url.trim()) return false;
      if (crawlExactList) return finalUrls.length > 0;
      // BFS path needs at least the start URL.
      return discovery.kind !== "discovering";
    }
    if (tab === "paste") return finalUrls.length > 0;
    return false;
  })();

  if (!open) return null;

  function parsePatterns(raw: string): string[] {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async function handleCategorize() {
    if (activeUrls.length === 0 || categorizing) return;
    setCategorizing(true);
    setError(null);
    try {
      const { topics: t } = await categorizeUrls({ urls: activeUrls });
      setTopics(t);
      setExcludedTopics(new Set());
    } catch (e: any) {
      setError(e?.message ?? "Categorization failed");
    } finally {
      setCategorizing(false);
    }
  }

  async function handleStart() {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      const includeArr = parsePatterns(includePaths);
      const excludeArr = parsePatterns(excludePaths);

      const baseConfig = {
        maxPages: Math.min(Math.max(maxPages, 1), 1000),
        maxDepth,
        includePaths: crawlBfs && includeArr.length ? includeArr : undefined,
        excludePaths: crawlBfs && excludeArr.length ? excludeArr : undefined,
        allowSubdomains,
        concurrency: Math.min(Math.max(concurrency, 1), 10),
        delay: Math.max(delay, 0),
      };

      const mode: "crawl" | "paste" = tab === "paste" ? "paste" : "crawl";
      const isExact = mode === "paste" || crawlExactList;

      const topicMap =
        topics && isExact
          ? Object.fromEntries(finalUrls.map((u) => [u, topics[u] ?? "Other"]))
          : undefined;

      const jobId = await startCrawl({
        kbId,
        startUrl: url.trim() || (finalUrls[0] ?? ""),
        mode,
        urls: isExact ? finalUrls : undefined,
        sitemapUrl: crawlExactList && discovery.kind === "found"
          ? discovery.sitemapUrl
          : undefined,
        topics: topicMap,
        config: baseConfig,
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
    } catch (e: any) {
      setError(e?.message ?? "Failed to start import");
    } finally {
      setStarting(false);
    }
  }

  const tabClass = (active: boolean) =>
    `flex-1 px-3 py-2 text-xs uppercase tracking-wide border-b-2 transition-colors ${
      active
        ? "border-accent text-text"
        : "border-transparent text-text-dim hover:text-text"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-2xl p-6 space-y-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">Import from URL</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex border-b border-border">
          <button className={tabClass(tab === "crawl")} onClick={() => setTab("crawl")}>
            Crawl
          </button>
          <button className={tabClass(tab === "paste")} onClick={() => setTab("paste")}>
            Paste URLs
          </button>
        </div>

        {/* ── Crawl tab ── */}
        {tab === "crawl" && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-text-muted uppercase tracking-wide">
                Website URL *
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                autoFocus
              />
            </div>

            {/* Discovery status banner */}
            {discovery.kind === "discovering" && (
              <div className="text-xs text-text-dim italic">
                Looking for a sitemap…
              </div>
            )}
            {discovery.kind === "found" && (
              <div className="text-xs space-y-0.5">
                <div className="text-accent">
                  ✓ Found sitemap — {discovery.urls.length} URL
                  {discovery.urls.length === 1 ? "" : "s"}
                  {truncated && (
                    <span className="text-yellow-400 ml-2">
                      (will import first {MAX_EXACT_URLS})
                    </span>
                  )}
                </div>
                <div className="text-text-dim font-mono truncate">
                  {discovery.sitemapUrl}
                </div>
              </div>
            )}
            {discovery.kind === "not-found" && (
              <div className="text-xs text-text-dim">
                No sitemap found — will crawl from start URL.
              </div>
            )}
            {discovery.kind === "error" && (
              <div className="text-xs text-yellow-400">
                Sitemap discovery failed: {discovery.message}. Will crawl from
                start URL.
              </div>
            )}

            {/* BFS crawl options — only when we don't have a sitemap */}
            {crawlBfs && (
              <>
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted uppercase tracking-wide">
                      Include Paths
                    </label>
                    <input
                      type="text"
                      value={includePaths}
                      onChange={(e) => setIncludePaths(e.target.value)}
                      placeholder="/docs/**, /help/**"
                      className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted uppercase tracking-wide">
                      Exclude Paths
                    </label>
                    <input
                      type="text"
                      value={excludePaths}
                      onChange={(e) => setExcludePaths(e.target.value)}
                      placeholder="/blog/**, /changelog/**"
                      className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
                    />
                  </div>
                </div>
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
                        <label className="text-xs text-text-muted uppercase tracking-wide">
                          Max Depth
                        </label>
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
                        <label className="text-xs text-text-muted uppercase tracking-wide">
                          Delay (ms)
                        </label>
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
              </>
            )}
          </>
        )}

        {/* ── Paste tab ── */}
        {tab === "paste" && (
          <div className="space-y-2">
            <label className="text-xs text-text-muted uppercase tracking-wide">
              Paste URLs, markdown, or any text containing URLs
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`https://example.com/page-one\nhttps://example.com/page-two\n…or drop a markdown file's contents here`}
              rows={8}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none font-mono"
            />
            <div className="text-xs text-text-dim">
              {pasteUrls.length === 0
                ? "No URLs detected yet."
                : `✓ ${pasteUrls.length} URL${pasteUrls.length === 1 ? "" : "s"} detected`}
              {truncated && (
                <span className="text-yellow-400 ml-2">
                  (will import first {MAX_EXACT_URLS})
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Auto-categorize (whenever we have an exact URL list) ── */}
        {(tab === "paste" || crawlExactList) && activeUrls.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs text-text-muted uppercase tracking-wide">
                Topics
              </label>
              <button
                onClick={handleCategorize}
                disabled={categorizing}
                className="text-xs px-3 py-1 border border-border rounded hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
              >
                {categorizing
                  ? "Categorizing..."
                  : topics
                    ? "Re-categorize"
                    : "Auto-categorize with AI"}
              </button>
            </div>
            {topicGroups && (
              <div className="flex flex-wrap gap-2">
                {topicGroups.map(([topic, urls]) => {
                  const excluded = excludedTopics.has(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => {
                        setExcludedTopics((prev) => {
                          const next = new Set(prev);
                          if (next.has(topic)) next.delete(topic);
                          else next.add(topic);
                          return next;
                        });
                      }}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        excluded
                          ? "border-border text-text-dim line-through"
                          : "border-accent/50 text-accent bg-accent/10"
                      }`}
                    >
                      {excluded ? "✗" : "✓"} {topic} ({urls.length})
                    </button>
                  );
                })}
              </div>
            )}
            {topics && (
              <div className="text-xs text-text-dim">
                {finalUrls.length} of {activeUrls.length} URLs will be imported.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2">
            {error}
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
            disabled={!canStart}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {starting ? "Starting..." : "Start Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
