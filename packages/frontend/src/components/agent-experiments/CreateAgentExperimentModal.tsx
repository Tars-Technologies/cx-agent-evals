"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface CreateAgentExperimentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (experimentId: Id<"experiments">) => void;
}

export function CreateAgentExperimentModal({
  open,
  onClose,
  onCreated,
}: CreateAgentExperimentModalProps) {
  const [name, setName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const agents = useQuery(api.crud.agents.byOrg);
  const datasets = useQuery(api.crud.datasets.list);
  const startExperiment = useMutation(api.experiments.orchestration.startAgentExperiment);

  useEffect(() => {
    if (nameManuallyEdited) return;
    const agent = (agents ?? []).find((a) => a._id === selectedAgentId);
    const dataset = (datasets ?? []).find((d) => d._id === selectedDatasetId);
    if (agent && dataset) {
      setName(`${agent.name} — ${dataset.name} — ${new Date().toISOString().slice(0, 10)}`);
    }
  }, [selectedAgentId, selectedDatasetId, agents, datasets, nameManuallyEdited]);

  if (!open) return null;

  const selectedAgent = (agents ?? []).find((a) => a._id === selectedAgentId);
  const canSubmit =
    name.trim() &&
    selectedAgentId &&
    selectedAgent?.status === "ready" &&
    selectedDatasetId &&
    !creating;

  async function handleCreate() {
    if (!canSubmit || !selectedAgentId || !selectedDatasetId) return;
    setError(null);
    setCreating(true);
    try {
      const result = await startExperiment({
        datasetId: selectedDatasetId,
        agentId: selectedAgentId,
        name: name.trim(),
      });
      onCreated(result.experimentId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start experiment");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-2xl w-[480px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">New Agent Experiment</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text text-lg px-2">&times;</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Experiment Name */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Experiment Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameManuallyEdited(true);
              }}
              placeholder="e.g., My Agent — Support Dataset — 2025-01-01"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
            />
          </div>

          {/* Agent */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Agent
            </label>
            <select
              value={selectedAgentId ?? ""}
              onChange={(e) =>
                setSelectedAgentId(e.target.value ? (e.target.value as Id<"agents">) : null)
              }
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent outline-none appearance-none"
            >
              <option value="">Select an agent...</option>
              {(agents ?? []).map((agent) => (
                <option
                  key={agent._id}
                  value={agent._id}
                  disabled={agent.status !== "ready"}
                >
                  {agent.name}{agent.status !== "ready" ? ` (${agent.status})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Dataset */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Dataset
            </label>
            <select
              value={selectedDatasetId ?? ""}
              onChange={(e) =>
                setSelectedDatasetId(e.target.value ? (e.target.value as Id<"datasets">) : null)
              }
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
            {creating ? "Creating..." : "Run Experiment"}
          </button>
        </div>
      </div>
    </div>
  );
}
