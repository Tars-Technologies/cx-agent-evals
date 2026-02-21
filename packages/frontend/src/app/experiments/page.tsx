"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { PipelineConfigModal } from "@/components/PipelineConfigModal";
import {
  PipelineConfigSummary,
  ConfigurePipelineButton,
} from "@/components/PipelineConfigSummary";
import type { PipelineConfig, SavedPipelineConfig } from "@/lib/pipeline-types";
import {
  PRESET_CONFIGS,
  PRESET_NAMES,
  PRESET_DESCRIPTIONS,
  isPresetUnmodified,
} from "@/lib/pipeline-types";
import {
  loadSavedConfigs,
  loadLastConfig,
  setLastConfigName,
  deleteConfig,
} from "@/lib/pipeline-storage";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExperimentsPage() {
  // --- Dataset selection ---
  const datasets = useQuery(api.datasets.list);
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);

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

  // --- Pipeline config state ---
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig | null>(null);
  const [configName, setConfigName] = useState("");
  const [basePreset, setBasePreset] = useState("baseline-vector-rag");
  const [k, setK] = useState(5);
  const [isModified, setIsModified] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedPipelineConfig>>({});
  const [showModal, setShowModal] = useState(false);

  // --- Auto-start toggle ---
  const [autoStart, setAutoStart] = useState(true);

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

  // --- Restore from localStorage on mount ---
  useEffect(() => {
    const saved = loadLastConfig();
    const allSaved = loadSavedConfigs();
    setSavedConfigs(allSaved);

    if (saved) {
      setPipelineConfig(saved.config);
      setConfigName(saved.name);
      setBasePreset(saved.basePreset);
      setK(saved.k);
      setIsModified(!isPresetUnmodified(saved.config, saved.k, saved.basePreset));
    } else {
      // Default to baseline-vector-rag
      const preset = PRESET_CONFIGS["baseline-vector-rag"];
      setPipelineConfig(preset);
      setConfigName("baseline-vector-rag");
      setBasePreset("baseline-vector-rag");
    }
  }, []);

  // --- Auto-generate experiment name ---
  useEffect(() => {
    if (nameEdited || !configName) return;
    setExperimentName(`${configName}-k${k}`);
  }, [configName, k, nameEdited]);

  // --- Derive execution status ---
  const jobPhase = job?.phase as string | undefined;
  const jobProgress = job?.progress as
    | { current?: number; total?: number; message?: string }
    | undefined;

  type ExecStatus = "idle" | "indexing" | "evaluating" | "complete" | "error";

  const execStatus: ExecStatus = !jobId
    ? "idle"
    : job?.status === "failed"
      ? "error"
      : job?.status === "completed"
        ? "complete"
        : jobPhase === "indexing" || jobPhase === "initializing"
          ? "indexing"
          : "evaluating";

  const isIndexingDone =
    execStatus === "evaluating" || execStatus === "complete";
  const isRunning = execStatus === "indexing" || execStatus === "evaluating";

  // Capture chunk count while indexing is in progress (before progress switches to evaluation)
  const [indexedChunkCount, setIndexedChunkCount] = useState<number | null>(null);
  useEffect(() => {
    if (jobPhase === "indexing" && jobProgress?.total) {
      setIndexedChunkCount(jobProgress.total);
    }
    if (execStatus === "idle") {
      setIndexedChunkCount(null);
    }
  }, [jobPhase, jobProgress, execStatus]);

  const completedScores = currentExperiment?.scores as
    | Record<string, number>
    | undefined;

  // --- Handlers ---

  function handlePresetSelect(presetOrSavedName: string) {
    if (!presetOrSavedName) return;

    // Check presets first
    const preset = PRESET_CONFIGS[presetOrSavedName];
    if (preset) {
      setPipelineConfig(preset);
      setConfigName(presetOrSavedName);
      setBasePreset(presetOrSavedName);
      setK(5);
      setIsModified(false);
      setLastConfigName(presetOrSavedName);
      return;
    }

    // Check saved configs
    const saved = savedConfigs[presetOrSavedName];
    if (saved) {
      setPipelineConfig(saved.config);
      setConfigName(saved.name);
      setBasePreset(saved.basePreset);
      setK(saved.k);
      setIsModified(!isPresetUnmodified(saved.config, saved.k, saved.basePreset));
      setLastConfigName(saved.name);
    }
  }

  function handleModalSave(saved: SavedPipelineConfig) {
    setPipelineConfig(saved.config);
    setConfigName(saved.name);
    setBasePreset(saved.basePreset);
    setK(saved.k);
    setIsModified(!isPresetUnmodified(saved.config, saved.k, saved.basePreset));
    setSavedConfigs(loadSavedConfigs());
    setShowModal(false);
  }

  function handleDeleteSaved(name: string) {
    deleteConfig(name);
    setSavedConfigs(loadSavedConfigs());
  }

  async function handleStartPipeline() {
    if (!selectedDatasetId || !pipelineConfig || isRunning) return;

    setError(null);

    const selectedMetrics = Object.entries(metrics)
      .filter(([, v]) => v)
      .map(([k]) => k);

    try {
      const result = await startExperiment({
        datasetId: selectedDatasetId,
        name: experimentName,
        retrieverConfig: { ...pipelineConfig, autoStart },
        k,
        metricNames: selectedMetrics,
      });

      setJobId(result.jobId);
      setExperimentId(result.experimentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start experiment");
    }
  }

  const canRun = !!selectedDatasetId && !!pipelineConfig && !isRunning;

  // --- Dropdown value ---
  const dropdownValue = isModified ? configName : basePreset;

  // --- Saved config names (excluding presets) ---
  const savedConfigNames = Object.keys(savedConfigs).filter(
    (name) => !PRESET_NAMES.includes(name),
  );

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
                      {datasets.map((ds) => (
                        <option key={ds._id} value={ds._id}>
                          {ds.name} ({ds.questionCount} questions)
                        </option>
                      ))}
                    </select>
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

                {/* Retriever Preset Dropdown */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-muted uppercase tracking-wide">
                      Retriever
                    </label>
                    {isModified && (
                      <span className="text-[10px] text-text-dim">(modified)</span>
                    )}
                  </div>
                  <select
                    value={dropdownValue}
                    onChange={(e) => handlePresetSelect(e.target.value)}
                    className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                  >
                    <option value="" disabled>
                      Select retriever preset...
                    </option>
                    <optgroup label="Presets">
                      {PRESET_NAMES.map((name) => (
                        <option key={name} value={name}>
                          {name} — {PRESET_DESCRIPTIONS[name]}
                        </option>
                      ))}
                    </optgroup>
                    {savedConfigNames.length > 0 && (
                      <optgroup label="Saved Configurations">
                        {savedConfigNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Pipeline Summary or Configure Button */}
                <div className="border border-border rounded bg-bg-elevated p-3">
                  {pipelineConfig ? (
                    <PipelineConfigSummary
                      config={pipelineConfig}
                      k={k}
                      configName={configName}
                      isModified={isModified}
                      onEdit={() => setShowModal(true)}
                    />
                  ) : (
                    <ConfigurePipelineButton onClick={() => setShowModal(true)} />
                  )}
                </div>

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
                    {nameEdited ? "Custom name" : "Auto-generated from config"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Execution Panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="p-4 space-y-4 overflow-y-auto">
            {/* Phase 1: Indexing */}
            <PhaseCard
              number={1}
              label="Indexing"
              status={
                execStatus === "idle"
                  ? "pending"
                  : execStatus === "indexing"
                    ? "running"
                    : execStatus === "error" && !isIndexingDone
                      ? "error"
                      : "complete"
              }
              pendingText="Will chunk, embed, and store documents using your Index configuration."
              runningText={
                jobProgress?.message ?? (jobPhase ? `${jobPhase}...` : "Starting...")
              }
              completeContent={
                <div className="space-y-1">
                  <p className="text-text-muted text-sm">
                    Indexing complete{indexedChunkCount ? ` · ${indexedChunkCount} chunks` : ""}
                  </p>
                  <a
                    href={`https://dashboard.convex.dev`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    View in Convex Dashboard
                    <ExternalLinkIcon />
                  </a>
                </div>
              }
              errorText={error || job?.error || "Indexing failed"}
            />

            {/* Connector */}
            <div className="flex justify-center">
              <div className="flex flex-col items-center">
                <div className="w-px h-4 bg-border" />
                <svg
                  className="w-3 h-3 text-text-dim"
                  fill="currentColor"
                  viewBox="0 0 12 12"
                >
                  <path d="M6 9L2 5h8L6 9z" />
                </svg>
              </div>
            </div>

            {/* Phase 2: Evaluation */}
            <PhaseCard
              number={2}
              label="Evaluation"
              status={
                execStatus === "idle" || execStatus === "indexing"
                  ? "pending"
                  : execStatus === "evaluating"
                    ? "running"
                    : execStatus === "error" && isIndexingDone
                      ? "error"
                      : execStatus === "complete"
                        ? "complete"
                        : "pending"
              }
              pendingText={
                execStatus === "indexing"
                  ? autoStart
                    ? "Will start automatically after indexing completes."
                    : "Will wait for you to start after indexing completes."
                  : "Will run retrieval + scoring against dataset using Search + Refinement stages."
              }
              pendingContent={
                !autoStart && isIndexingDone ? (
                  <div className="space-y-2">
                    <p className="text-text-muted text-sm">Indexing complete. Ready to evaluate.</p>
                    <button
                      onClick={handleStartPipeline}
                      disabled={!canRun}
                      className="px-4 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider
                                 transition-all cursor-pointer
                                 bg-accent/10 border-accent/30 text-accent hover:bg-accent/20
                                 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Run Experiment
                    </button>
                  </div>
                ) : undefined
              }
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

            {/* Auto-start toggle + Run button */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                />
                <span className="text-sm text-text-muted">
                  Auto-start experiment after indexing
                </span>
              </label>

              <button
                onClick={handleStartPipeline}
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
                    <span>Start Pipeline</span>
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
            </div>

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

      {/* Pipeline Config Modal */}
      {showModal && pipelineConfig && (
        <PipelineConfigModal
          initialConfig={pipelineConfig}
          initialK={k}
          initialName={configName}
          basePreset={basePreset}
          onSave={handleModalSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseCard component
// ---------------------------------------------------------------------------

type PhaseStatus = "pending" | "running" | "complete" | "error";

function PhaseCard({
  number,
  label,
  status,
  pendingText,
  pendingContent,
  runningText,
  completeContent,
  errorText,
}: {
  number: number;
  label: string;
  status: PhaseStatus;
  pendingText: string;
  pendingContent?: React.ReactNode;
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
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-bg-surface text-text-dim border border-border">
          {number}
        </span>
        <span className="text-sm text-text font-medium">Phase {number}: {label}</span>
        <span className={`ml-auto flex items-center gap-1.5 text-xs uppercase tracking-wide ${labelClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {statusLabel}
        </span>
      </div>

      {status === "pending" && (
        pendingContent ?? <p className="text-text-muted text-sm">{pendingText}</p>
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
