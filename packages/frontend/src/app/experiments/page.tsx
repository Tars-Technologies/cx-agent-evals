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
  const questionDatasets = (kbDatasets ?? []).filter(d => !d.type || d.type === "questions");
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const selectedDataset = useQuery(
    api.crud.datasets.get,
    selectedDatasetId ? { id: selectedDatasetId } : "skip",
  );

  // --- Experiment mode toggle ---
  const [experimentMode, setExperimentMode] = useState<"agent" | "retriever">("agent");

  // --- Agents for org ---
  const orgAgents = useQuery(api.crud.agents.byOrg, {});

  // --- Retrievers for selected KB (ready only) ---
  const kbRetrievers = useQuery(
    api.crud.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const readyRetrievers = (kbRetrievers ?? []).filter((r) => r.status === "ready");
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());

  // --- Agents filtered by KB (has at least one ready retriever on selected KB) ---
  const kbAgents = (orgAgents ?? []).filter(
    (agent) =>
      agent.status === "ready" &&
      agent.retrieverIds.some((rid) =>
        readyRetrievers.some((r) => r._id === rid),
      ),
  );
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);

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
      if (experimentMode === "retriever" && selectedRetrieverIds.size > 0) {
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
    setSelectedAgentId(null);
  }, [selectedKbId]);

  useEffect(() => {
    setSelectedRetrieverIds(new Set());
    setSelectedAgentId(null);
  }, [selectedDatasetId]);

  // --- Experiment execution ---
  const startExperiment = useMutation(api.experiments.orchestration.start);
  const startAgentExperiment = useMutation(api.experiments.orchestration.startAgentExperiment);
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

  async function handleRunAgentExperiment() {
    if (!selectedDatasetId || !selectedAgentId) return;
    setError(null);

    const agent = kbAgents.find((a) => a._id === selectedAgentId);
    const datasetName = selectedDataset?.name ?? "dataset";
    const name = `${agent?.name ?? "Agent"}-${datasetName}`;

    try {
      const result = await startAgentExperiment({
        datasetId: selectedDatasetId,
        agentId: selectedAgentId,
        name,
      });
      setRunningExperimentIds((prev) => new Set([...prev, result.experimentId]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent experiment");
    }
  }

  const canRunRetriever = !!selectedDatasetId && selectedRetrieverIds.size > 0;
  const canRunAgent = !!selectedDatasetId && !!selectedAgentId;

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
                  ) : questionDatasets.length === 0 ? (
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
                        {questionDatasets.map((ds) => (
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

            {/* Experiment Type Toggle — appears after dataset selected */}
            {selectedKbId && selectedDatasetId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Experiment Type
                </div>
                <div className="p-4">
                  <div className="flex rounded-lg overflow-hidden border border-border">
                    <button
                      onClick={() => setExperimentMode("agent")}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        experimentMode === "agent"
                          ? "bg-purple-500/20 text-purple-300 border-r border-border"
                          : "bg-bg-elevated text-text-dim hover:text-text border-r border-border"
                      }`}
                    >
                      Agent
                    </button>
                    <button
                      onClick={() => setExperimentMode("retriever")}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        experimentMode === "retriever"
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-bg-elevated text-text-dim hover:text-text"
                      }`}
                    >
                      Retriever
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Selector — when agent mode */}
            {selectedKbId && selectedDatasetId && experimentMode === "agent" && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Agent
                </div>
                <div className="p-4 space-y-4">
                  {orgAgents === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading agents...
                    </div>
                  ) : kbAgents.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No ready agents for this KB.{" "}
                      <Link
                        href="/agents"
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        Create one
                      </Link>
                    </div>
                  ) : (
                    <select
                      value={selectedAgentId ?? ""}
                      onChange={(e) =>
                        setSelectedAgentId(
                          e.target.value ? (e.target.value as Id<"agents">) : null,
                        )
                      }
                      className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                    >
                      <option value="">Select an agent...</option>
                      {kbAgents.map((agent) => (
                        <option key={agent._id} value={agent._id}>
                          {agent.name} ({agent.model})
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    onClick={handleRunAgentExperiment}
                    disabled={!canRunAgent}
                    className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                      canRunAgent
                        ? "bg-purple-500 hover:bg-purple-500/90 text-white cursor-pointer"
                        : "bg-border text-text-dim cursor-not-allowed"
                    }`}
                  >
                    Run Agent Experiment
                  </button>

                  {error && experimentMode === "agent" && (
                    <div className="text-xs text-red-400">{error}</div>
                  )}
                </div>
              </div>
            )}

            {/* Retriever Selector — when retriever mode */}
            {selectedKbId && selectedDatasetId && experimentMode === "retriever" && (
              <>
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

                {/* Metrics + Run */}
                <div className="border border-border rounded-lg bg-bg">
                  <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                    Configuration
                  </div>
                  <div className="p-4 space-y-4">
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

                    <button
                      onClick={handleRunExperiments}
                      disabled={!canRunRetriever}
                      className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                        canRunRetriever
                          ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
                          : "bg-border text-text-dim cursor-not-allowed"
                      }`}
                    >
                      Run Experiment{selectedRetrieverIds.size > 1 ? "s" : ""}{" "}
                      {selectedRetrieverIds.size > 1 && `(${selectedRetrieverIds.size})`}
                    </button>

                    {error && experimentMode === "retriever" && (
                      <div className="text-xs text-red-400">{error}</div>
                    )}
                  </div>
                </div>
              </>
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
  const isAgent = exp.experimentType === "agent" || exp.agentId != null;

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
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isAgent
                ? "bg-purple-500/15 text-purple-300"
                : "bg-blue-500/15 text-blue-300"
            }`}
          >
            {isAgent ? "Agent" : "Retriever"}
          </span>
          <div className="font-medium text-text text-sm">{exp.name}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[exp.status] ?? "bg-text-dim/10 text-text-dim"}`}>
          {exp.status}
        </span>
      </div>
      {exp.status === "running" && exp.processedQuestions != null && (
        <div className="mt-1 text-xs text-text-dim">
          {exp.phase ?? "Evaluating"}... ({exp.processedQuestions}/{exp.totalQuestions ?? "?"})
        </div>
      )}
      {!isAgent && scores && Object.keys(scores).length > 0 && (
        <div className="flex gap-4 mt-2 text-sm">
          {Object.entries(scores).slice(0, 4).map(([key, value]) => (
            <span key={key} className="text-text-muted">
              {key === "iou" ? "IoU" : key}: <span className="text-accent">{value.toFixed(3)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2">
        {isAgent && (exp.status === "completed" || exp.status === "completed_with_errors" || exp.status === "running") && (
          <Link
            href={`/experiments/${exp._id}/annotate`}
            className="inline-flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200 transition-colors"
          >
            {exp.status === "running" && (
              <span className="relative flex h-2 w-2 mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400" />
              </span>
            )}
            {exp.status === "running" ? "Annotate Live" : "Annotate"}
            <ArrowRightIcon />
          </Link>
        )}
        {exp.langsmithUrl && (
          <a
            href={exp.langsmithUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent transition-colors"
          >
            View in LangSmith
            <ExternalLinkIcon />
          </a>
        )}
      </div>
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
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}
