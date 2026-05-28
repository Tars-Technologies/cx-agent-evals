"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

interface FromFailureModeModalProps {
  agentId: Id<"agents">;
  open: boolean;
  onClose(): void;
  onSpawned(evaluatorId: Id<"evaluators">): void;
}

export function FromFailureModeModal({
  agentId,
  open,
  onClose,
  onSpawned,
}: FromFailureModeModalProps) {
  const analyses = useQuery(
    api.errorAnalysis.orchestration.byAgent,
    open ? { agentId } : "skip",
  );
  const [analysisId, setAnalysisId] = useState<Id<"errorAnalyses"> | "">("");
  const failureModes = useQuery(
    api.failureModes.crud.byAnalysis,
    analysisId ? { errorAnalysisId: analysisId as Id<"errorAnalyses"> } : "skip",
  );
  const [failureModeId, setFailureModeId] = useState<Id<"failureModes"> | "">("");
  const spawn = useMutation(api.evaluator.spawnJudge.fromFailureMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (!open) return;
    setAnalysisId("");
    setFailureModeId("");
    setSubmitting(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const canSubmit = !!failureModeId && !submitting;

  async function handleSubmit() {
    if (!failureModeId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await spawn({
        failureModeId: failureModeId as Id<"failureModes">,
      });
      onSpawned(id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to spawn judge");
      setSubmitting(false);
    }
  }

  const analysesList = analyses ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">
            Spawn judge from failure mode
          </h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Step 1: pick analysis */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Analysis
          </label>
          {analyses === undefined ? (
            <div className="h-9 rounded bg-bg-surface border border-border animate-pulse" />
          ) : analysesList.length === 0 ? (
            <p className="text-xs text-text-dim py-2">
              No error analyses yet. Create one to discover failure modes
              first.
            </p>
          ) : (
            <select
              value={analysisId}
              onChange={(e) => {
                setAnalysisId(
                  e.target.value as Id<"errorAnalyses"> | "",
                );
                setFailureModeId("");
              }}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
            >
              <option value="">Select an analysis…</option>
              {analysesList.map((a) => (
                <option
                  key={a._id}
                  value={a._id}
                  disabled={a.failureModeCount === 0}
                >
                  {a.name} ({a.failureModeCount} failure mode
                  {a.failureModeCount === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Step 2: pick failure mode */}
        {analysisId && (
          <div className="space-y-1">
            <label className="text-xs text-text-muted uppercase tracking-wide">
              Failure mode
            </label>
            {failureModes === undefined ? (
              <div className="h-9 rounded bg-bg-surface border border-border animate-pulse" />
            ) : failureModes.length === 0 ? (
              <p className="text-xs text-text-dim py-2">
                This analysis has no failure modes.
              </p>
            ) : (
              <select
                value={failureModeId}
                onChange={(e) =>
                  setFailureModeId(
                    e.target.value as Id<"failureModes"> | "",
                  )
                }
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
              >
                <option value="">Select a failure mode…</option>
                {failureModes.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <p className="text-xs text-text-dim leading-relaxed">
          Labels will be auto-inherited from your annotations: members of this
          failure mode become &quot;fail&quot; labels, and other annotated
          conversations in this analysis become &quot;pass&quot; labels.
        </p>

        {error && (
          <div className="text-xs text-red-400 border border-red-900/50 bg-red-950/30 rounded px-3 py-2">
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
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Spawning…" : "Spawn judge"}
          </button>
        </div>
      </div>
    </div>
  );
}
