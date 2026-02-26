"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExperimentsPage() {
  // --- Retriever selection ---
  const readyRetrievers = useQuery(api.retrievers.byOrg, { status: "ready" });
  const [selectedRetrieverId, setSelectedRetrieverId] = useState<Id<"retrievers"> | null>(null);

  const selectedRetriever = readyRetrievers?.find((r) => r._id === selectedRetrieverId) ?? null;

  // --- Dataset selection (filtered by retriever's KB when possible) ---
  const datasets = useQuery(api.datasets.list);
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);

  // Filter datasets to same KB as selected retriever
  const filteredDatasets = datasets?.filter((ds) => {
    if (!selectedRetriever) return true;
    return ds.kbId === selectedRetriever.kbId;
  });

  // Clear dataset if it no longer matches the selected retriever's KB
  useEffect(() => {
    if (!selectedRetriever || !selectedDatasetId || !datasets) return;
    const ds = datasets.find((d) => d._id === selectedDatasetId);
    if (ds && ds.kbId !== selectedRetriever.kbId) {
      setSelectedDatasetId(null);
    }
  }, [selectedRetriever, selectedDatasetId, datasets]);

  const experiments = useQuery(
    api.experiments.byDataset,
    selectedDatasetId ? { datasetId: selectedDatasetId } : "skip",
  );

  const selectedDataset = useQuery(
    api.datasets.get,
    selectedDatasetId ? { id: selectedDatasetId } : "skip",
  );

  // --- Experiment execution state ---
  const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);
  const [experimentId, setExperimentId] = useState<Id<"experiments"> | null>(null);

  const job = useQuery(api.jobs.get, jobId ? { id: jobId } : "skip");
  const currentExperiment = useQuery(
    api.experiments.get,
    experimentId ? { id: experimentId } : "skip",
  );

  const startExperiment = useMutation(api.experiments.start);

  // --- Metrics ---
  const [metrics, setMetrics] = useState({
    recall: true,
    precision: true,
    iou: true,
    f1: true,
  });

  // --- Experiment name ---
  const [experimentName, setExperimentName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Auto-generate experiment name from retriever + dataset ---
  useEffect(() => {
    if (nameEdited) return;
    const parts: string[] = [];
    if (selectedRetriever) parts.push(selectedRetriever.name);
    if (selectedDataset) parts.push(selectedDataset.name);
    setExperimentName(parts.length > 0 ? parts.join("-") : "");
  }, [selectedRetriever, selectedDataset, nameEdited]);

  // --- Derive execution status ---
  const jobProgress = job?.progress as
    | { current?: number; total?: number; message?: string }
    | undefined;

  type ExecStatus = "idle" | "evaluating" | "complete" | "error";

  const execStatus: ExecStatus = !jobId
    ? "idle"
    : job?.status === "failed"
      ? "error"
      : job?.status === "completed"
        ? "complete"
        : "evaluating";

  const isRunning = execStatus === "evaluating";

  const completedScores = currentExperiment?.scores as
    | Record<string, number>
    | undefined;

  // --- Handlers ---

  async function handleStartExperiment() {
    if (!selectedDatasetId || !selectedRetrieverId || isRunning) return;

    setError(null);

    const selectedMetrics = Object.entries(metrics)
      .filter(([, v]) => v)
      .map(([k]) => k);

    try {
      const result = await startExperiment({
        datasetId: selectedDatasetId,
        name: experimentName,
        retrieverId: selectedRetrieverId,
        metricNames: selectedMetrics,
      });

      setJobId(result.jobId);
      setExperimentId(result.experimentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start experiment");
    }
  }

  const canRun = !!selectedDatasetId && !!selectedRetrieverId && !isRunning;

  return (
    <div className="flex flex-col h-screen">
      <Header mode="experiments" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Configuration Panel */}
        <div className="w-[420px] flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-4">
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Configuration
              </div>
              <div className="p-4 space-y-4">
                {/* Retriever Selector */}
                <div className="space-y-2">
                  <label className="text-xs text-text-muted uppercase tracking-wide">
                    Retriever
                  </label>
                  {readyRetrievers === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading retrievers...
                    </div>
                  ) : readyRetrievers.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No ready retrievers.{" "}
                      <a href="/retrievers" className="text-accent hover:text-accent/80 transition-colors">
                        Create one
                      </a>
                    </div>
                  ) : (
                    <select
                      value={selectedRetrieverId ?? ""}
                      onChange={(e) => {
                        setSelectedRetrieverId(
                          e.target.value ? (e.target.value as Id<"retrievers">) : null,
                        );
                      }}
                      className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                    >
                      <option value="">Select a retriever...</option>
                      {readyRetrievers.map((r) => (
                        <option key={r._id} value={r._id}>
                          {r.name} ({r.chunkCount ?? "?"} chunks, k={r.defaultK})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Retriever Info */}
                {selectedRetriever && (
                  <div className="border border-border rounded bg-bg-elevated p-3 space-y-1 text-[11px]">
                    <div className="text-text-dim uppercase tracking-wide text-[10px]">
                      Retriever Info
                    </div>
                    <div className="text-text-muted">
                      Chunks: {selectedRetriever.chunkCount ?? "?"}
                    </div>
                    <div className="text-text-muted">
                      k: {selectedRetriever.defaultK}
                    </div>
                  </div>
                )}

                {/* Dataset Picker */}
                <div className="space-y-2">
                  <label className="text-xs text-text-muted uppercase tracking-wide">
                    Dataset
                  </label>
                  {datasets === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading datasets...
                    </div>
                  ) : (
                    <select
                      value={selectedDatasetId ?? ""}
                      onChange={(e) => {
                        setSelectedDatasetId(
                          e.target.value ? (e.target.value as Id<"datasets">) : null,
                        );
                      }}
                      className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                    >
                      <option value="">Select a dataset...</option>
                      {(filteredDatasets ?? []).map((ds) => (
                        <option key={ds._id} value={ds._id}>
                          {ds.name} ({ds.questionCount} questions)
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedRetriever && filteredDatasets && filteredDatasets.length === 0 && (
                    <div className="text-[11px] text-text-dim">
                      No datasets found for this retriever&apos;s KB.
                    </div>
                  )}
                </div>

                {/* Dataset Info */}
                {selectedDataset && (
                  <div className="border border-border rounded bg-bg-elevated p-3 space-y-2">
                    <div className="text-xs text-text-dim uppercase tracking-wide">
                      Dataset Info
                    </div>
                    <div className="text-sm text-text-muted">
                      Strategy: {selectedDataset.strategy}
                    </div>
                    <div className="text-sm text-text-muted">
                      Questions: {selectedDataset.questionCount}
                    </div>
                    {selectedDataset.langsmithSyncStatus && (
                      <div className="text-xs text-text-dim">
                        LangSmith: {selectedDataset.langsmithSyncStatus}
                      </div>
                    )}
                  </div>
                )}

                {/* Metrics */}
                <div className="border border-border rounded bg-bg-elevated p-3 space-y-3">
                  <div className="text-xs text-text-dim uppercase tracking-wide">
                    Metrics
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(["recall", "precision", "iou", "f1"] as const).map(
                      (metric) => (
                        <label
                          key={metric}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={metrics[metric]}
                            onChange={(e) =>
                              setMetrics({
                                ...metrics,
                                [metric]: e.target.checked,
                              })
                            }
                            className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                          />
                          <span className="text-sm text-text-muted capitalize">
                            {metric === "iou" ? "IoU" : metric}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>

                {/* Experiment Name */}
                <div className="border border-border rounded bg-bg-elevated p-3 space-y-3">
                  <div className="text-xs text-text-dim uppercase tracking-wide">
                    Experiment Name
                  </div>
                  <input
                    type="text"
                    value={experimentName}
                    onChange={(e) => {
                      setExperimentName(e.target.value);
                      setNameEdited(true);
                    }}
                    className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent outline-none"
                  />
                  <div className="text-xs text-text-dim">
                    {nameEdited ? "Custom name" : "Auto-generated from retriever + dataset"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Execution Panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="p-4 space-y-4 overflow-y-auto">
            {/* Evaluation Phase Card */}
            <PhaseCard
              label="Evaluation"
              status={
                execStatus === "idle"
                  ? "pending"
                  : execStatus === "evaluating"
                    ? "running"
                    : execStatus === "error"
                      ? "error"
                      : "complete"
              }
              pendingText="Select a retriever and dataset, then run the experiment."
              runningText={
                jobProgress?.message ?? "Evaluating..."
              }
              completeContent={
                completedScores ? (
                  <div className="space-y-3">
                    <p className="text-text text-sm font-medium">
                      {experimentName}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(completedScores).map(([key, value]) => (
                        <div key={key} className="bg-bg rounded p-2">
                          <span className="text-text-dim text-xs capitalize">
                            {key === "iou" ? "IoU" : key}
                          </span>
                          <span className="block text-accent text-lg font-medium">
                            {(value as number).toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {currentExperiment?.langsmithUrl && (
                      <a
                        href={currentExperiment.langsmithUrl as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                      >
                        View in LangSmith
                        <ExternalLinkIcon />
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-text-muted text-sm">Experiment complete</p>
                )
              }
              errorText={error || job?.error || "Evaluation failed"}
            />

            {/* Run button */}
            <button
              onClick={handleStartExperiment}
              disabled={!canRun}
              className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                canRun
                  ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
                  : "bg-border text-text-dim cursor-not-allowed"
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-bg-elevated/30 border-t-bg-elevated rounded-full animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <span>Run Experiment</span>
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </>
              )}
            </button>

            {/* Recent Experiments */}
            {selectedDatasetId && (
              <div className="border border-border rounded-lg bg-bg-elevated">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Recent Experiments
                </div>
                <div className="p-4 space-y-3">
                  {experiments === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading...
                    </div>
                  ) : experiments.length === 0 ? (
                    <p className="text-text-dim text-sm">
                      No experiments yet for this dataset
                    </p>
                  ) : (
                    experiments.map((exp) => (
                      <div
                        key={exp._id}
                        className="border border-border rounded-lg p-4 hover:border-border/80 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-text">{exp.name}</div>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              exp.status === "completed"
                                ? "bg-accent/10 text-accent"
                                : exp.status === "failed"
                                  ? "bg-red-500/10 text-red-400"
                                  : "bg-text-dim/10 text-text-dim"
                            }`}
                          >
                            {exp.status}
                          </span>
                        </div>
                        {exp.scores &&
                          typeof exp.scores === "object" &&
                          Object.keys(exp.scores as Record<string, number>)
                            .length > 0 && (
                            <div className="flex gap-4 mt-2 text-sm">
                              {Object.entries(
                                exp.scores as Record<string, number>,
                              )
                                .slice(0, 4)
                                .map(([key, value]) => (
                                  <span key={key} className="text-text-muted">
                                    {key}:{" "}
                                    <span className="text-accent">
                                      {value.toFixed(3)}
                                    </span>
                                  </span>
                                ))}
                            </div>
                          )}
                        {exp.langsmithUrl && (
                          <a
                            href={exp.langsmithUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent mt-3 transition-colors"
                          >
                            View in LangSmith
                            <ExternalLinkIcon />
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseCard component
// ---------------------------------------------------------------------------

type PhaseStatus = "pending" | "running" | "complete" | "error";

function PhaseCard({
  label,
  status,
  pendingText,
  runningText,
  completeContent,
  errorText,
}: {
  label: string;
  status: PhaseStatus;
  pendingText: string;
  runningText: string;
  completeContent: React.ReactNode;
  errorText: string;
}) {
  const borderClass =
    status === "running"
      ? "border-accent/30 bg-accent/5"
      : status === "complete"
        ? "border-accent/30 bg-accent/5"
        : status === "error"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border bg-bg-elevated";

  const dotClass =
    status === "running"
      ? "bg-accent animate-pulse"
      : status === "complete"
        ? "bg-accent"
        : status === "error"
          ? "bg-red-500"
          : "bg-text-dim";

  const labelClass =
    status === "running"
      ? "text-accent"
      : status === "complete"
        ? "text-accent"
        : status === "error"
          ? "text-red-500"
          : "text-text-dim";

  const statusLabel =
    status === "pending"
      ? "Pending"
      : status === "running"
        ? "Running"
        : status === "complete"
          ? "Complete"
          : "Error";

  return (
    <div className={`border rounded-lg p-4 ${borderClass}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm text-text font-medium">{label}</span>
        <span className={`ml-auto flex items-center gap-1.5 text-xs uppercase tracking-wide ${labelClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {statusLabel}
        </span>
      </div>

      {status === "pending" && (
        <p className="text-text-muted text-sm">{pendingText}</p>
      )}

      {status === "running" && (
        <div>
          <p className="text-text-muted text-sm">{runningText}</p>
          <div className="mt-2 h-1 bg-bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-accent/60 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      )}

      {status === "complete" && completeContent}

      {status === "error" && (
        <p className="text-red-400 text-sm">{errorText}</p>
      )}
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
