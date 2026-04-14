"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface CreateExperimentModalProps {
  open: boolean;
  onClose: () => void;
  kbId: Id<"knowledgeBases">;
  onCreated: (runId: Id<"experimentRuns">) => void;
}

export function CreateExperimentModal({
  open,
  onClose,
  kbId,
  onCreated,
}: CreateExperimentModalProps) {
  const [name, setName] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());
  const [metrics, setMetrics] = useState({ recall: true, precision: true, f1: false, iou: false });
  const [recallWeight, setRecallWeight] = useState(0.7);
  const [precisionWeight, setPrecisionWeight] = useState(0.3);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datasets = useQuery(api.crud.datasets.byKb, { kbId });
  const retrievers = useQuery(api.crud.retrievers.byKb, { kbId });
  const readyRetrievers = (retrievers ?? []).filter((r) => r.status === "ready");
  const createRun = useMutation(api.experimentRuns.orchestration.create);

  if (!open) return null;

  const toggleRetriever = (id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit =
    name.trim() &&
    selectedDatasetId &&
    selectedRetrieverIds.size > 0 &&
    (metrics.recall || metrics.precision) &&
    Math.abs(recallWeight + precisionWeight - 1.0) < 0.01 &&
    !creating;

  async function handleCreate() {
    if (!canSubmit || !selectedDatasetId) return;
    setError(null);
    setCreating(true);
    try {
      const metricNames = Object.entries(metrics)
        .filter(([, v]) => v)
        .map(([k]) => k);

      const result = await createRun({
        name: name.trim(),
        kbId,
        datasetId: selectedDatasetId,
        retrieverIds: Array.from(selectedRetrieverIds),
        metricNames,
        scoringWeights: { recall: recallWeight, precision: precisionWeight },
      });
      onCreated(result.runId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-2xl w-[560px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Create Experiment</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text text-lg px-2">&times;</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Experiment Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Full Comparison - Support KB"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
            />
          </div>

          {/* Dataset */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Dataset
            </label>
            <select
              value={selectedDatasetId ?? ""}
              onChange={(e) => setSelectedDatasetId(e.target.value ? (e.target.value as Id<"datasets">) : null)}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent outline-none appearance-none"
            >
              <option value="">Select a dataset...</option>
              {(datasets ?? []).map((ds) => (
                <option key={ds._id} value={ds._id}>
                  {ds.name} ({ds.questionCount} questions)
                </option>
              ))}
            </select>
          </div>

          {/* Retrievers */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Retrievers
            </label>
            <div className="border border-border rounded-md max-h-44 overflow-y-auto p-1.5 space-y-1">
              {readyRetrievers.length === 0 ? (
                <div className="text-xs text-text-dim p-2">No ready retrievers for this KB.</div>
              ) : (
                readyRetrievers.map((r) => (
                  <label
                    key={r._id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded cursor-pointer transition-colors ${
                      selectedRetrieverIds.has(r._id)
                        ? "bg-accent/8 border border-accent/20"
                        : "hover:bg-bg-hover border border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRetrieverIds.has(r._id)}
                      onChange={() => toggleRetriever(r._id)}
                      className="w-3.5 h-3.5 rounded accent-accent"
                    />
                    <div>
                      <div className="text-xs text-text">{r.name}</div>
                      <div className="text-[10px] text-text-dim">
                        {r.chunkCount ?? "?"} chunks, k={r.defaultK}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="text-[10px] text-text-dim mt-1">
              {selectedRetrieverIds.size} selected
            </div>
          </div>

          {/* Metrics */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Metrics
            </label>
            <div className="flex gap-4">
              {(["recall", "precision", "f1", "iou"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={metrics[m]}
                    onChange={(e) => setMetrics({ ...metrics, [m]: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-accent"
                  />
                  {m === "iou" ? "IoU" : m === "f1" ? "F1" : m.charAt(0).toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Ranking Formula */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Ranking Formula
            </label>
            <div className="flex items-center gap-2 text-xs text-text-dim">
              <input
                type="number"
                value={recallWeight}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setRecallWeight(val);
                  setPrecisionWeight(Math.round((1.0 - val) * 100) / 100);
                }}
                min={0}
                max={1}
                step={0.1}
                className="w-14 bg-bg border border-border rounded px-2 py-1 text-center text-text text-xs"
              />
              <span>&times; Recall +</span>
              <input
                type="number"
                value={precisionWeight}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setPrecisionWeight(val);
                  setRecallWeight(Math.round((1.0 - val) * 100) / 100);
                }}
                min={0}
                max={1}
                step={0.1}
                className="w-14 bg-bg border border-border rounded px-2 py-1 text-center text-text text-xs"
              />
              <span>&times; Precision</span>
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs border border-border rounded-md text-text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors ${
              canSubmit
                ? "bg-accent text-bg-elevated hover:bg-accent/90 cursor-pointer"
                : "bg-border text-text-dim cursor-not-allowed"
            }`}
          >
            {creating ? "Creating..." : "Create Experiment"}
          </button>
        </div>
      </div>
    </div>
  );
}
