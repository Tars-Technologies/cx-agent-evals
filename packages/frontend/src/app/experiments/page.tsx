"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { KBDropdown } from "@/components/KBDropdown";
import { useKbFromUrl, buildKbLink } from "@/lib/useKbFromUrl";
import Link from "next/link";

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="experiments" /></div>}>
      <ExperimentsPageContent />
    </Suspense>
  );
}

function ExperimentsPageContent() {
  // --- KB selection (from URL) ---
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();

  // --- Datasets for selected KB ---
  const kbDatasets = useQuery(
    api.crud.datasets.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const selectedDataset = useQuery(
    api.crud.datasets.get,
    selectedDatasetId ? { id: selectedDatasetId } : "skip",
  );

  // --- Retrievers for selected KB (ready only) ---
  const kbRetrievers = useQuery(
    api.crud.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const readyRetrievers = (kbRetrievers ?? []).filter((r) => r.status === "ready");
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());

  // --- Progressive experiment queries ---
  const kbExperiments = useQuery(
    api.experiments.orchestration.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const datasetExperiments = useQuery(
    api.experiments.orchestration.byDataset,
    selectedDatasetId ? { datasetId: selectedDatasetId } : "skip",
  );

  // Determine which experiments to display based on selection level
  const displayExperiments = (() => {
    if (selectedDatasetId && datasetExperiments) {
      // Filter by selected retrievers if any
      if (selectedRetrieverIds.size > 0) {
        return datasetExperiments.filter(
          (exp) => exp.retrieverId && selectedRetrieverIds.has(exp.retrieverId),
        );
      }
      return datasetExperiments;
    }
    if (selectedKbId && kbExperiments) {
      return kbExperiments;
    }
    return [];
  })();

  // --- Clear dependent selections when parent changes ---
  useEffect(() => {
    setSelectedDatasetId(null);
    setSelectedRetrieverIds(new Set());
  }, [selectedKbId]);

  useEffect(() => {
    setSelectedRetrieverIds(new Set());
  }, [selectedDatasetId]);

  // --- Experiment execution ---
  const startExperiment = useMutation(api.experiments.orchestration.start);
  const [runningExperimentIds, setRunningExperimentIds] = useState<Set<Id<"experiments">>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // --- Metrics ---
  const [metrics, setMetrics] = useState({
    recall: true,
    precision: true,
    iou: true,
    f1: true,
  });

  // --- Handlers ---
  const toggleRetriever = useCallback((id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function handleRunExperiments() {
    if (!selectedDatasetId || selectedRetrieverIds.size === 0) return;
    setError(null);

    const selectedMetrics = Object.entries(metrics)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const retrieverList = readyRetrievers.filter((r) => selectedRetrieverIds.has(r._id));
    const datasetName = selectedDataset?.name ?? "dataset";

    for (const retriever of retrieverList) {
      try {
        const name = `${retriever.name}-${datasetName}`;
        const result = await startExperiment({
          datasetId: selectedDatasetId,
          name,
          retrieverId: retriever._id,
          metricNames: selectedMetrics,
        });
        setRunningExperimentIds((prev) => new Set([...prev, result.experimentId]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start experiment");
        break;
      }
    }
  }

  const canRun = !!selectedDatasetId && selectedRetrieverIds.size > 0;

  return (
    <div className="flex flex-col h-screen">
      <Header mode="experiments" kbId={selectedKbId} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Configuration Panel */}
        <div className="w-[360px] flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* KB Selector */}
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Knowledge Base
              </div>
              <div className="p-4">
                <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
              </div>
            </div>

            {/* Dataset Selector — appears after KB */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Dataset
                </div>
                <div className="p-4 space-y-2">
                  {kbDatasets === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading datasets...
                    </div>
                  ) : kbDatasets.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No datasets for this KB.{" "}
                      <Link
                        href={buildKbLink("/generate", selectedKbId)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        Create one
                      </Link>
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedDatasetId ?? ""}
                        onChange={(e) =>
                          setSelectedDatasetId(
                            e.target.value ? (e.target.value as Id<"datasets">) : null,
                          )
                        }
                        className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                      >
                        <option value="">Select a dataset...</option>
                        {kbDatasets.map((ds) => (
                          <option key={ds._id} value={ds._id}>
                            {ds.name} ({ds.questionCount} questions)
                          </option>
                        ))}
                      </select>
                      {selectedDataset && (
                        <div className="border border-border rounded bg-bg-elevated p-3 space-y-1 text-[11px]">
                          <div className="text-text-dim">Strategy: {selectedDataset.strategy}</div>
                          <div className="text-text-dim">Questions: {selectedDataset.questionCount}</div>
                          {selectedDataset.langsmithSyncStatus && (
                            <div className="text-text-dim">LangSmith: {selectedDataset.langsmithSyncStatus}</div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Retriever Selector — multi-select, appears after KB */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Retrievers {selectedRetrieverIds.size > 0 && `(${selectedRetrieverIds.size} selected)`}
                </div>
                <div className="p-4 space-y-2">
                  {kbRetrievers === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading retrievers...
                    </div>
                  ) : readyRetrievers.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No ready retrievers for this KB.{" "}
                      <Link
                        href={buildKbLink("/retrievers", selectedKbId)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        Create one
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {readyRetrievers.map((r) => (
                        <label
                          key={r._id}
                          className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                            selectedRetrieverIds.has(r._id)
                              ? "bg-accent/10 border border-accent/30"
                              : "hover:bg-bg-hover border border-transparent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedRetrieverIds.has(r._id)}
                            onChange={() => toggleRetriever(r._id)}
                            className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                          />
                          <div className="text-xs">
                            <div className="text-text">{r.name}</div>
                            <div className="text-text-dim text-[10px]">
                              {r.chunkCount ?? "?"} chunks, k={r.defaultK}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Metrics + Run */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Configuration
                </div>
                <div className="p-4 space-y-4">
                  {/* Metrics */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-dim uppercase tracking-wide">Metrics</div>
                    <div className="flex flex-wrap gap-3">
                      {(["recall", "precision", "iou", "f1"] as const).map((metric) => (
                        <label key={metric} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={metrics[metric]}
                            onChange={(e) => setMetrics({ ...metrics, [metric]: e.target.checked })}
                            className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                          />
                          <span className="text-sm text-text-muted capitalize">
                            {metric === "iou" ? "IoU" : metric}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Run button */}
                  <button
                    onClick={handleRunExperiments}
                    disabled={!canRun}
                    className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                      canRun
                        ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
                        : "bg-border text-text-dim cursor-not-allowed"
                    }`}
                  >
                    Run Experiment{selectedRetrieverIds.size > 1 ? "s" : ""}{" "}
                    {selectedRetrieverIds.size > 1 && `(${selectedRetrieverIds.size})`}
                  </button>

                  {error && (
                    <div className="text-xs text-red-400">{error}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Experiment Results */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="border border-border rounded-lg bg-bg-elevated">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Experiments
                {selectedDatasetId
                  ? " — filtered by dataset"
                  : selectedKbId
                    ? " — all for this KB"
                    : ""}
              </div>
              <div className="p-4">
                {!selectedKbId ? (
                  <p className="text-text-dim text-sm">Select a knowledge base to see experiments.</p>
                ) : displayExperiments.length === 0 ? (
                  <p className="text-text-dim text-sm">No experiments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {displayExperiments.map((exp) => (
                      <ExperimentRow key={exp._id} experiment={exp} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExperimentRow
// ---------------------------------------------------------------------------

function ExperimentRow({ experiment: exp }: { experiment: any }) {
  const statusColors: Record<string, string> = {
    completed: "bg-accent/10 text-accent",
    completed_with_errors: "bg-yellow-500/10 text-yellow-400",
    failed: "bg-red-500/10 text-red-400",
    running: "bg-blue-500/10 text-blue-400",
    pending: "bg-text-dim/10 text-text-dim",
    canceling: "bg-yellow-500/10 text-yellow-400",
    canceled: "bg-text-dim/10 text-text-dim",
  };

  const scores = exp.scores as Record<string, number> | undefined;

  return (
    <div className="border border-border rounded-lg p-4 hover:border-border/80 transition-colors">
      <div className="flex items-center justify-between">
        <div className="font-medium text-text text-sm">{exp.name}</div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[exp.status] ?? "bg-text-dim/10 text-text-dim"}`}>
          {exp.status}
        </span>
      </div>
      {exp.status === "running" && exp.processedQuestions != null && (
        <div className="mt-1 text-xs text-text-dim">
          {exp.phase ?? "Evaluating"}... ({exp.processedQuestions}/{exp.totalQuestions ?? "?"})
        </div>
      )}
      {scores && Object.keys(scores).length > 0 && (
        <div className="flex gap-4 mt-2 text-sm">
          {Object.entries(scores).slice(0, 4).map(([key, value]) => (
            <span key={key} className="text-text-muted">
              {key === "iou" ? "IoU" : key}: <span className="text-accent">{value.toFixed(3)}</span>
            </span>
          ))}
        </div>
      )}
      {exp.langsmithUrl && (
        <a
          href={exp.langsmithUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent mt-2 transition-colors"
        >
          View in LangSmith
          <ExternalLinkIcon />
        </a>
      )}
      <div className="text-[10px] text-text-dim mt-1">
        {new Date(exp.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ExternalLinkIcon() {
  return (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
