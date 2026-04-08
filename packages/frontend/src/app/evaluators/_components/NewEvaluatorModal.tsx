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
  const [selectedExpId, setSelectedExpId] = useState<Id<"experiments"> | "">("");
  const [selectedFmId, setSelectedFmId] = useState<Id<"failureModes"> | "">("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createConfig = useMutation(api.evaluator.crud.createConfig);

  // Load all experiments for this KB
  const experiments = useQuery(api.experiments.orchestration.byKb, { kbId });
  const agentExperiments = (experiments ?? []).filter(
    (e) => e.experimentType === "agent",
  );

  // Load failure modes for selected experiment
  const failureModes = useQuery(
    api.failureModes.crud.byExperiment,
    selectedExpId ? { experimentId: selectedExpId as Id<"experiments"> } : "skip",
  );

  // Load existing configs for selected experiment to filter out FMs that already have one
  const existingConfigs = useQuery(
    api.evaluator.crud.configsByExperiment,
    selectedExpId ? { experimentId: selectedExpId as Id<"experiments"> } : "skip",
  );
  const usedFmIds = new Set(
    (existingConfigs ?? []).map((c) => c.failureModeId),
  );
  const availableFailureModes = (failureModes ?? []).filter(
    (fm) => !usedFmIds.has(fm._id),
  );

  const handleCreate = async () => {
    if (!selectedExpId || !selectedFmId) return;
    setCreating(true);
    setError(null);
    try {
      const fm = (failureModes ?? []).find((f) => f._id === selectedFmId);
      if (!fm) throw new Error("Failure mode not found");

      const defaultPrompt = `You are an expert evaluator assessing outputs from an AI agent.

Your Task: Determine if the agent's response exhibits the following failure mode.

Failure Mode: ${fm.name}
Description: ${fm.description}

Definition of Pass/Fail:
- Fail: The agent's response clearly exhibits this failure mode.
- Pass: The agent's response does NOT exhibit this failure mode.

Output Format: Return a JSON object with exactly two keys:
1. "reasoning": A brief explanation (1-2 sentences) for your decision.
2. "answer": Either "Pass" or "Fail".`;

      const configId = await createConfig({
        experimentId: selectedExpId as Id<"experiments">,
        failureModeId: selectedFmId as Id<"failureModes">,
        judgePrompt: defaultPrompt,
        fewShotExampleIds: [],
        modelId: "claude-sonnet-4-6",
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
          {/* Experiment selector */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Source Experiment
            </label>
            <select
              value={selectedExpId}
              onChange={(e) => {
                setSelectedExpId(e.target.value as any);
                setSelectedFmId("");
              }}
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
              Pick the experiment whose annotations &amp; failure modes you want to use.
            </p>
          </div>

          {/* Failure mode selector */}
          {selectedExpId && (
            <div>
              <label className="block text-xs font-medium text-text-dim mb-1.5">
                Failure Mode
              </label>
              {failureModes === undefined ? (
                <div className="text-xs text-text-dim">Loading...</div>
              ) : failureModes.length === 0 ? (
                <div className="text-xs text-yellow-400">
                  No failure modes generated yet for this experiment. Generate
                  failure modes first.
                </div>
              ) : availableFailureModes.length === 0 ? (
                <div className="text-xs text-yellow-400">
                  All failure modes already have an evaluator.
                </div>
              ) : (
                <select
                  value={selectedFmId}
                  onChange={(e) => setSelectedFmId(e.target.value as any)}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text"
                >
                  <option value="">Select a failure mode...</option>
                  {availableFailureModes.map((fm) => (
                    <option key={fm._id} value={fm._id}>
                      {fm.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-text-dim hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedExpId || !selectedFmId || creating}
            className="px-4 py-1.5 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Evaluator"}
          </button>
        </div>
      </div>
    </div>
  );
}
