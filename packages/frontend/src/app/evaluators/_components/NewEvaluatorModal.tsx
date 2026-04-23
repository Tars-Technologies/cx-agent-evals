"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface NewEvaluatorModalProps {
  kbId: Id<"knowledgeBases">;
  onClose: () => void;
  onCreated: (configId: Id<"evaluatorConfigs">) => void;
}

export function NewEvaluatorModal({
  kbId,
  onClose,
  onCreated,
}: NewEvaluatorModalProps) {
  const [name, setName] = useState("");
  const [selectedExpId, setSelectedExpId] = useState<Id<"experiments"> | "">(
    "",
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createConfig = useMutation(api.evaluator.crud.createConfig);

  // Load all experiments for this KB
  const experiments = useQuery(api.experiments.orchestration.byKb, { kbId });
  const agentExperiments = (experiments ?? []).filter(
    (e) => e.experimentType === "agent",
  );

  // Validate failure modes exist for selected experiment
  const failureModes = useQuery(
    api.failureModes.crud.byExperiment,
    selectedExpId
      ? { experimentId: selectedExpId as Id<"experiments"> }
      : "skip",
  );

  const noFailureModes = selectedExpId && failureModes && failureModes.length === 0;

  const handleCreate = async () => {
    if (!selectedExpId || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const configId = await createConfig({
        experimentId: selectedExpId as Id<"experiments">,
        name: name.trim(),
      });
      onCreated(configId);
    } catch (e: any) {
      setError(e.message ?? "Failed to create evaluator");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-elevated border border-border rounded-lg w-full max-w-md p-6">
        <h2 className="text-lg font-medium text-text mb-4">
          New LLM Evaluator
        </h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tone judge v1"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-dim/60"
              autoFocus
            />
          </div>

          {/* Experiment selector */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Source Experiment
            </label>
            <select
              value={selectedExpId}
              onChange={(e) => setSelectedExpId(e.target.value as any)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              <option value="">Select an experiment...</option>
              {agentExperiments.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-dim">
              The experiment whose annotations &amp; failure modes will train this judge.
            </p>
          </div>

          {noFailureModes && (
            <div className="text-xs text-yellow-400">
              No failure modes generated yet for this experiment. Generate
              failure modes first.
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-text-dim hover:text-text transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={
              !selectedExpId || !name.trim() || !!noFailureModes || creating
            }
            className="px-4 py-1.5 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
          >
            {creating ? "Creating..." : "Create Evaluator"}
          </button>
        </div>
      </div>
    </div>
  );
}
