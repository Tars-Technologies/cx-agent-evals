"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { KBSelector } from "@/components/KBSelector";
import { PipelineConfigModal } from "@/components/PipelineConfigModal";
import {
  PipelineConfigSummary,
  ConfigurePipelineButton,
} from "@/components/PipelineConfigSummary";
import { RetrieverCard } from "@/components/RetrieverCard";
import { RetrieverPlayground } from "@/components/RetrieverPlayground";
import type { PipelineConfig, SavedPipelineConfig } from "@/lib/pipeline-types";
import {
  PRESET_CONFIGS,
  PRESET_NAMES,
  PRESET_DESCRIPTIONS,
  DEFAULT_K,
  isPresetUnmodified,
} from "@/lib/pipeline-types";
import {
  loadSavedConfigs,
  loadLastConfig,
  setLastConfigName,
} from "@/lib/pipeline-storage";

// ---------------------------------------------------------------------------
// Wrapper: queries indexing job progress for "indexing" retrievers
// ---------------------------------------------------------------------------

function RetrieverCardWithProgress({
  retriever,
  isSelected,
  isHighlighted,
  onToggleSelect,
  onStartIndexing,
  onCancelIndexing,
  onDeleteIndex,
  onDelete,
}: {
  retriever: any;
  isSelected: boolean;
  isHighlighted: boolean;
  onToggleSelect: (id: Id<"retrievers">) => void;
  onStartIndexing: (id: Id<"retrievers">) => void;
  onCancelIndexing: (id: Id<"retrievers">, jobId?: string) => void;
  onDeleteIndex: (id: Id<"retrievers">) => void;
  onDelete: (id: Id<"retrievers">) => void;
}) {
  const job = useQuery(
    api.indexing.getJob,
    retriever.status === "indexing" && retriever.indexingJobId
      ? { jobId: retriever.indexingJobId }
      : "skip",
  );

  const indexingProgress = job
    ? { totalDocs: job.totalDocs, processedDocs: job.processedDocs, failedDocs: job.failedDocs }
    : null;

  return (
    <RetrieverCard
      retriever={retriever}
      indexingProgress={indexingProgress}
      isSelected={isSelected}
      isHighlighted={isHighlighted}
      onToggleSelect={onToggleSelect}
      onStartIndexing={onStartIndexing}
      onCancelIndexing={onCancelIndexing}
      onDeleteIndex={onDeleteIndex}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RetrieversPage() {
  // --- KB selection ---
  const [selectedKbId, setSelectedKbId] = useState<Id<"knowledgeBases"> | null>(null);

  // --- Pipeline config state ---
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig | null>(null);
  const [configName, setConfigName] = useState("");
  const [basePreset, setBasePreset] = useState("baseline-vector-rag");
  const [isModified, setIsModified] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedPipelineConfig>>({});
  const [showModal, setShowModal] = useState(false);

  // --- Retriever list ---
  const retrievers = useQuery(
    api.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );

  // --- Actions & Mutations ---
  const createRetriever = useAction(api.retrieverActions.create);
  const startIndexingAction = useAction(api.retrieverActions.startIndexing);
  const removeRetriever = useMutation(api.retrievers.remove);
  const deleteIndexMutation = useMutation(api.retrievers.deleteIndex);
  const resetAfterCancelMutation = useMutation(api.retrievers.resetAfterCancel);
  const cancelIndexingMutation = useMutation(api.indexing.cancelIndexing);

  // --- UI state ---
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dupMessage, setDupMessage] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<Id<"retrievers"> | null>(null);

  // --- Selected retrievers for playground ---
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(
    new Set(),
  );

  // --- Restore config from localStorage on mount ---
  useEffect(() => {
    const saved = loadLastConfig();
    const allSaved = loadSavedConfigs();
    setSavedConfigs(allSaved);

    if (saved) {
      const config = saved.config.k == null && saved.k != null
        ? { ...saved.config, k: saved.k }
        : saved.config;
      setPipelineConfig(config);
      setConfigName(saved.name);
      setBasePreset(saved.basePreset);
      setIsModified(!isPresetUnmodified(config, saved.basePreset));
    } else {
      const preset = PRESET_CONFIGS["baseline-vector-rag"];
      setPipelineConfig(preset);
      setConfigName("baseline-vector-rag");
      setBasePreset("baseline-vector-rag");
    }
  }, []);

  // Clear highlight after a delay
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  // --- Handlers ---

  function handlePresetSelect(presetOrSavedName: string) {
    if (!presetOrSavedName) return;

    const preset = PRESET_CONFIGS[presetOrSavedName];
    if (preset) {
      setPipelineConfig(preset);
      setConfigName(presetOrSavedName);
      setBasePreset(presetOrSavedName);
      setIsModified(false);
      setLastConfigName(presetOrSavedName);
      return;
    }

    const saved = savedConfigs[presetOrSavedName];
    if (saved) {
      const config = saved.config.k == null && saved.k != null
        ? { ...saved.config, k: saved.k }
        : saved.config;
      setPipelineConfig(config);
      setConfigName(saved.name);
      setBasePreset(saved.basePreset);
      setIsModified(!isPresetUnmodified(config, saved.basePreset));
      setLastConfigName(saved.name);
    }
  }

  function handleModalSave(saved: SavedPipelineConfig) {
    setPipelineConfig(saved.config);
    setConfigName(saved.name);
    setBasePreset(saved.basePreset);
    setIsModified(!isPresetUnmodified(saved.config, saved.basePreset));
    setSavedConfigs(loadSavedConfigs());
    setShowModal(false);
  }

  async function handleCreateRetriever() {
    if (!selectedKbId || !pipelineConfig || isCreating) return;

    setIsCreating(true);
    setCreateError(null);
    setDupMessage(null);
    setHighlightedId(null);

    try {
      const configToSend = { ...pipelineConfig, name: configName };
      const result = await createRetriever({
        kbId: selectedKbId,
        retrieverConfig: configToSend,
      });

      if (result.existing) {
        setDupMessage("A retriever with this configuration already exists.");
        setHighlightedId(result.retrieverId);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create retriever");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleStartIndexing(id: Id<"retrievers">) {
    try {
      await startIndexingAction({ retrieverId: id });
    } catch (err) {
      console.error("Failed to start indexing:", err);
    }
  }

  async function handleCancelIndexing(id: Id<"retrievers">, jobId?: string) {
    try {
      if (jobId) {
        await cancelIndexingMutation({ jobId: jobId as Id<"indexingJobs"> });
      }
      await resetAfterCancelMutation({ id });
    } catch (err) {
      console.error("Failed to cancel indexing:", err);
    }
  }

  async function handleDeleteIndex(id: Id<"retrievers">) {
    try {
      await deleteIndexMutation({ id });
    } catch (err) {
      console.error("Failed to delete index:", err);
    }
  }

  async function handleDelete(id: Id<"retrievers">) {
    try {
      await removeRetriever({ id });
      setSelectedRetrieverIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      console.error("Failed to delete retriever:", err);
    }
  }

  const handleToggleSelect = useCallback((id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // --- Derived ---
  const canCreate = !!selectedKbId && !!pipelineConfig && !isCreating;
  const dropdownValue = isModified ? configName : basePreset;
  const savedConfigNames = Object.keys(savedConfigs).filter(
    (name) => !PRESET_NAMES.includes(name),
  );

  const readyRetrievers = (retrievers ?? []).filter((r) => r.status === "ready");
  const selectedRetrievers = readyRetrievers
    .filter((r) => selectedRetrieverIds.has(r._id))
    .map((r) => ({ _id: r._id, name: r.name, defaultK: r.defaultK }));

  return (
    <div className="flex flex-col h-screen">
      <Header mode="retrievers" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Configuration Panel */}
        <div className="w-[420px] flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* KB Selector */}
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Knowledge Base
              </div>
              <div className="p-4">
                <KBSelector
                  selectedKbId={selectedKbId}
                  onSelect={setSelectedKbId}
                />
              </div>
            </div>

            {/* Pipeline Config */}
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Retriever Configuration
              </div>
              <div className="p-4 space-y-4">
                {/* Preset Dropdown */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-muted uppercase tracking-wide">
                      Preset
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

                {/* Summary or Configure */}
                <div className="border border-border rounded bg-bg-elevated p-3">
                  {pipelineConfig ? (
                    <PipelineConfigSummary
                      config={pipelineConfig}
                      configName={configName}
                      isModified={isModified}
                      onEdit={() => setShowModal(true)}
                    />
                  ) : (
                    <ConfigurePipelineButton onClick={() => setShowModal(true)} />
                  )}
                </div>

                {/* Feedback messages */}
                {createError && (
                  <div className="text-xs text-red-400">{createError}</div>
                )}
                {dupMessage && (
                  <div className="text-xs text-accent border border-accent/20 bg-accent/5 rounded px-3 py-2">
                    {dupMessage}
                  </div>
                )}

                {/* Create Retriever Button */}
                <button
                  onClick={handleCreateRetriever}
                  disabled={!canCreate}
                  className={`w-full py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors text-sm ${
                    canCreate
                      ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
                      : "bg-border text-text-dim cursor-not-allowed"
                  }`}
                >
                  {isCreating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-bg-elevated/30 border-t-bg-elevated rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Retriever"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Retriever List + Playground */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="p-4 space-y-6 overflow-y-auto">
            {/* Retriever List */}
            <div className="border border-border rounded-lg bg-bg-elevated">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Retrievers{selectedKbId ? "" : " — select a KB"}
              </div>
              <div className="p-4">
                {!selectedKbId ? (
                  <p className="text-text-dim text-sm">
                    Select a knowledge base to see its retrievers.
                  </p>
                ) : retrievers === undefined ? (
                  <div className="flex items-center gap-2 text-text-dim text-sm">
                    <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Loading retrievers...
                  </div>
                ) : retrievers.length === 0 ? (
                  <p className="text-text-dim text-sm">
                    No retrievers yet. Configure a pipeline and click &quot;Create Retriever&quot;.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {retrievers.map((r) => (
                      <RetrieverCardWithProgress
                        key={r._id}
                        retriever={r as any}
                        isSelected={selectedRetrieverIds.has(r._id)}
                        isHighlighted={highlightedId === r._id}
                        onToggleSelect={handleToggleSelect}
                        onStartIndexing={handleStartIndexing}
                        onCancelIndexing={handleCancelIndexing}
                        onDeleteIndex={handleDeleteIndex}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Playground */}
            <div className="border border-border rounded-lg bg-bg-elevated">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Playground
              </div>
              <div className="p-4">
                <RetrieverPlayground selectedRetrievers={selectedRetrievers} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Config Modal */}
      {showModal && pipelineConfig && (
        <PipelineConfigModal
          initialConfig={pipelineConfig}
          initialName={configName}
          basePreset={basePreset}
          onSave={handleModalSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
