"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  PipelineConfig,
  IndexConfig,
  SearchConfig,
  RefinementStepConfig,
  SavedPipelineConfig,
} from "@/lib/pipeline-types";
import {
  DEFAULT_INDEX_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  PRESET_CONFIGS,
  PRESET_NAMES,
  resolveConfig,
} from "@/lib/pipeline-types";
import { saveConfig, configHash } from "@/lib/pipeline-storage";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineConfigModalProps {
  initialConfig: PipelineConfig;
  initialK: number;
  initialName: string;
  basePreset: string;
  onSave: (saved: SavedPipelineConfig) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPresetMatch(config: PipelineConfig, k: number, presetName: string): boolean {
  const preset = PRESET_CONFIGS[presetName];
  if (!preset) return false;
  const a = resolveConfig({ ...config, name: "cmp" });
  const b = resolveConfig({ ...preset, name: "cmp" });
  return deepEqual(a, b) && k === 5;
}

function buildAutoName(presetName: string, config: PipelineConfig, k: number): string {
  if (isPresetMatch(config, k, presetName)) return presetName;
  // Normalize name to a constant so the hash is stable (name must not feed into itself)
  const normalized = resolveConfig({ ...config, name: "" });
  const { name: _, ...withoutName } = normalized;
  const hash = configHash(JSON.stringify({ ...withoutName, k }));
  return `${presetName}-${hash}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineConfigModal({
  initialConfig,
  initialK,
  initialName,
  basePreset,
  onSave,
  onClose,
}: PipelineConfigModalProps) {
  // --- Local state ---
  const resolved = resolveConfig(initialConfig);

  const [chunkSize, setChunkSize] = useState(resolved.index.chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState(resolved.index.chunkOverlap);
  const [embeddingModel, setEmbeddingModel] = useState(resolved.index.embeddingModel);
  const [vectorStore] = useState("convex");

  const [searchStrategy, setSearchStrategy] = useState<"dense" | "bm25" | "hybrid">(
    resolved.search.strategy,
  );
  const [k, setK] = useState(initialK);
  const [denseWeight, setDenseWeight] = useState(
    resolved.search.strategy === "hybrid" ? (resolved.search.denseWeight ?? 0.7) : 0.7,
  );
  const [sparseWeight, setSparseWeight] = useState(
    resolved.search.strategy === "hybrid" ? (resolved.search.sparseWeight ?? 0.3) : 0.3,
  );
  const [fusionMethod, setFusionMethod] = useState<"weighted" | "rrf">(
    resolved.search.strategy === "hybrid"
      ? (resolved.search.fusionMethod ?? "weighted")
      : "weighted",
  );
  const [candidateMultiplier, setCandidateMultiplier] = useState(
    resolved.search.strategy === "hybrid"
      ? (resolved.search.candidateMultiplier ?? 4)
      : 4,
  );
  const [bm25K1, setBm25K1] = useState(
    resolved.search.strategy === "bm25"
      ? (resolved.search.k1 ?? 1.2)
      : resolved.search.strategy === "hybrid"
        ? (resolved.search.k1 ?? 1.2)
        : 1.2,
  );
  const [bm25B, setBm25B] = useState(
    resolved.search.strategy === "bm25"
      ? (resolved.search.b ?? 0.75)
      : resolved.search.strategy === "hybrid"
        ? (resolved.search.b ?? 0.75)
        : 0.75,
  );

  const [refinementSteps, setRefinementSteps] = useState<RefinementStepConfig[]>(
    [...resolved.refinement],
  );

  const [name, setName] = useState(initialName);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // --- Build config from local state (excludes `name` to avoid circular deps) ---
  const buildConfig = useCallback((): PipelineConfig => {
    const index: IndexConfig = {
      strategy: "plain",
      chunkSize,
      chunkOverlap,
      embeddingModel,
    };

    let search: SearchConfig;
    switch (searchStrategy) {
      case "dense":
        search = { strategy: "dense" };
        break;
      case "bm25":
        search = { strategy: "bm25", k1: bm25K1, b: bm25B };
        break;
      case "hybrid":
        search = {
          strategy: "hybrid",
          denseWeight,
          sparseWeight,
          fusionMethod,
          candidateMultiplier,
          k1: bm25K1,
          b: bm25B,
        };
        break;
    }

    return {
      name: "",
      index,
      query: { strategy: "identity" },
      search,
      refinement: refinementSteps.length > 0 ? refinementSteps : undefined,
    };
  }, [
    chunkSize, chunkOverlap, embeddingModel, searchStrategy, bm25K1, bm25B,
    denseWeight, sparseWeight, fusionMethod, candidateMultiplier,
    refinementSteps,
  ]);

  // --- Auto-name when config changes ---
  useEffect(() => {
    if (nameManuallyEdited) return;
    const config = buildConfig();
    setName(buildAutoName(basePreset, config, k));
  }, [
    chunkSize, chunkOverlap, embeddingModel, searchStrategy, bm25K1, bm25B,
    denseWeight, sparseWeight, fusionMethod, candidateMultiplier,
    refinementSteps, k, basePreset, nameManuallyEdited, buildConfig,
  ]);

  // --- Derived state ---
  const currentConfig = buildConfig();
  const isUnmodified = isPresetMatch(currentConfig, k, basePreset);
  const isNameReadOnly = isUnmodified;

  // --- Validation ---
  useEffect(() => {
    if (isUnmodified) {
      setValidationError(null);
      return;
    }
    if (PRESET_NAMES.includes(name)) {
      setValidationError("Name matches a preset but config has been modified");
    } else {
      setValidationError(null);
    }
  }, [name, isUnmodified]);

  // --- Save handler ---
  function handleSave() {
    if (validationError) return;
    const config = { ...buildConfig(), name };
    const saved: SavedPipelineConfig = {
      name,
      basePreset,
      config,
      k,
    };
    saveConfig(saved);
    onSave(saved);
  }

  // --- Refinement step helpers ---
  function addRefinementStep() {
    setRefinementSteps((prev) => [...prev, { type: "rerank" }]);
  }

  function removeRefinementStep(index: number) {
    setRefinementSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRefinementStep(index: number, step: RefinementStepConfig) {
    setRefinementSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col bg-bg-elevated border border-border rounded-lg shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">
            Pipeline Configuration
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors cursor-pointer text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Preset label + Name field */}
          <div className="space-y-3">
            <div className="text-[11px] text-text-dim">
              Base preset:{" "}
              <span className="text-text-muted font-medium">{basePreset}</span>
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">
                Configuration name
              </label>
              <input
                type="text"
                value={name}
                readOnly={isNameReadOnly}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameManuallyEdited(true);
                }}
                className={`w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-sm text-text
                           focus:outline-none focus:border-accent/50 transition-colors
                           ${isNameReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
              />
              <div className="text-[10px] text-text-dim mt-1">
                {isNameReadOnly
                  ? "Auto-generated from preset"
                  : nameManuallyEdited
                    ? "Custom name"
                    : "Auto-generated from config"}
              </div>
              {validationError && (
                <div className="text-[10px] text-error mt-1">{validationError}</div>
              )}
            </div>
          </div>

          {/* ① INDEX */}
          <StageSection number={1} label="INDEX">
            <div className="space-y-3">
              {/* Chunker */}
              <div>
                <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
                  Chunker
                </div>
                <div className="text-[11px] text-text-muted mb-2">
                  Type: recursive
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] text-text-dim mb-1">Size</label>
                    <input
                      type="number"
                      value={chunkSize}
                      onChange={(e) => setChunkSize(parseInt(e.target.value) || 1000)}
                      className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] text-text-dim mb-1">Overlap</label>
                    <input
                      type="number"
                      value={chunkOverlap}
                      onChange={(e) => setChunkOverlap(parseInt(e.target.value) || 200)}
                      className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Embedder */}
              <div>
                <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
                  Embedder
                </div>
                <select
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                >
                  <option value="text-embedding-3-small">text-embedding-3-small</option>
                  <option value="text-embedding-3-large">text-embedding-3-large</option>
                  <option value="text-embedding-ada-002">text-embedding-ada-002</option>
                </select>
              </div>

              {/* Vector Store */}
              <div>
                <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
                  Vector Store
                </div>
                <select
                  value={vectorStore}
                  disabled
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text opacity-80"
                >
                  <option value="convex">convex</option>
                  <option disabled>chroma (coming soon)</option>
                  <option disabled>in-memory (coming soon)</option>
                  <option disabled>qdrant (coming soon)</option>
                </select>
              </div>
            </div>
          </StageSection>

          {/* ② QUERY */}
          <StageSection number={2} label="QUERY">
            <div>
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
                Strategy
              </div>
              <select
                value="identity"
                disabled
                className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text opacity-80"
              >
                <option value="identity">identity (passthrough)</option>
                <option disabled>hyde (coming soon)</option>
                <option disabled>multi-query (coming soon)</option>
              </select>
            </div>
          </StageSection>

          {/* ③ SEARCH */}
          <StageSection number={3} label="SEARCH">
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
                  Strategy
                </div>
                <select
                  value={searchStrategy}
                  onChange={(e) => {
                    const next = e.target.value as "dense" | "bm25" | "hybrid";
                    setSearchStrategy(next);
                    // Reset conditional params to defaults when strategy changes
                    setDenseWeight(0.7);
                    setSparseWeight(0.3);
                    setFusionMethod("weighted");
                    setCandidateMultiplier(4);
                    setBm25K1(1.2);
                    setBm25B(0.75);
                  }}
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                >
                  <option value="dense">dense</option>
                  <option value="bm25">bm25</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-text-dim mb-1">
                  k (top results)
                </label>
                <input
                  type="number"
                  value={k}
                  onChange={(e) => setK(parseInt(e.target.value) || 5)}
                  min={1}
                  max={100}
                  className="w-24 bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                />
              </div>

              {/* Hybrid Parameters */}
              {searchStrategy === "hybrid" && (
                <div className="border-t border-border/50 pt-3 space-y-3">
                  <div className="text-[10px] text-text-dim uppercase tracking-wider">
                    Hybrid Parameters
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        Dense weight
                      </label>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={1}
                        value={denseWeight}
                        onChange={(e) => setDenseWeight(parseFloat(e.target.value) || 0.7)}
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        Sparse weight
                      </label>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={1}
                        value={sparseWeight}
                        onChange={(e) => setSparseWeight(parseFloat(e.target.value) || 0.3)}
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        Fusion method
                      </label>
                      <select
                        value={fusionMethod}
                        onChange={(e) =>
                          setFusionMethod(e.target.value as "weighted" | "rrf")
                        }
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      >
                        <option value="weighted">weighted</option>
                        <option value="rrf">rrf</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        Candidate multiplier
                      </label>
                      <input
                        type="number"
                        value={candidateMultiplier}
                        onChange={(e) =>
                          setCandidateMultiplier(parseInt(e.target.value) || 4)
                        }
                        min={1}
                        max={20}
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* BM25 Tuning */}
              {(searchStrategy === "bm25" || searchStrategy === "hybrid") && (
                <div className="border-t border-border/50 pt-3 space-y-3">
                  <div className="text-[10px] text-text-dim uppercase tracking-wider">
                    BM25 Tuning
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        k1
                      </label>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={bm25K1}
                        onChange={(e) => setBm25K1(parseFloat(e.target.value) || 1.2)}
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] text-text-dim mb-1">
                        b
                      </label>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        max={1}
                        value={bm25B}
                        onChange={(e) => setBm25B(parseFloat(e.target.value) || 0.75)}
                        className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </StageSection>

          {/* ④ REFINEMENT */}
          <StageSection number={4} label="REFINEMENT">
            <div className="space-y-3">
              {refinementSteps.length === 0 && (
                <div className="text-[11px] text-text-dim">
                  No refinement steps configured.
                </div>
              )}

              {refinementSteps.map((step, i) => (
                <div
                  key={i}
                  className="p-3 rounded border border-border bg-bg-surface"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-text-dim uppercase tracking-wider">
                      Step {i + 1}
                    </span>
                    <button
                      onClick={() => removeRefinementStep(i)}
                      className="text-text-dim hover:text-error transition-colors cursor-pointer text-xs"
                    >
                      &times;
                    </button>
                  </div>
                  <select
                    value={step.type}
                    onChange={(e) => {
                      const type = e.target.value as "rerank" | "threshold";
                      if (type === "rerank") {
                        updateRefinementStep(i, { type: "rerank" });
                      } else {
                        updateRefinementStep(i, { type: "threshold", minScore: 0.5 });
                      }
                    }}
                    className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors mb-2"
                  >
                    <option value="rerank">rerank</option>
                    <option value="threshold">threshold</option>
                  </select>
                  {step.type === "rerank" && (
                    <div className="text-[10px] text-text-dim">
                      Model: cohere-rerank-v3
                    </div>
                  )}
                  {step.type === "threshold" && (
                    <div>
                      <label className="block text-[10px] text-text-dim mb-1">
                        Min score
                      </label>
                      <input
                        type="number"
                        step={0.05}
                        min={0}
                        max={1}
                        value={step.minScore}
                        onChange={(e) =>
                          updateRefinementStep(i, {
                            type: "threshold",
                            minScore: parseFloat(e.target.value) || 0.5,
                          })
                        }
                        className="w-24 bg-bg border border-border rounded px-2 py-1 text-sm text-text focus:border-accent/50 focus:outline-none transition-colors"
                      />
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={addRefinementStep}
                className="w-full py-2 rounded border border-dashed border-border text-xs text-text-dim
                           hover:border-accent/30 hover:text-accent transition-all cursor-pointer"
              >
                + Add refinement step
              </button>
            </div>
          </StageSection>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-border">
          <button
            onClick={handleSave}
            disabled={!!validationError}
            className="px-4 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider
                       transition-all cursor-pointer
                       disabled:opacity-30 disabled:cursor-not-allowed
                       bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage section wrapper
// ---------------------------------------------------------------------------

function StageSection({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-bg-surface flex items-center gap-2">
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-accent/20 text-accent">
          {number}
        </span>
        <span className="text-xs text-text-dim uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
