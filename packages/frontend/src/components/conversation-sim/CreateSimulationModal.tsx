"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function CreateSimulationModal({
  agentId,
  onClose,
  onCreated,
}: {
  agentId: Id<"agents">;
  onClose: () => void;
  onCreated: (simulationId: Id<"conversationSimulations">) => void;
}) {
  const startSimulation = useMutation(api.conversationSim.orchestration.start);

  // Load conversation_sim datasets (org-wide)
  const datasets = useQuery(api.crud.datasets.list) ?? [];
  const simDatasets = datasets.filter(d => d.type === "conversation_sim");

  // Form state
  const [datasetId, setDatasetId] = useState<Id<"datasets"> | "">("");
  const [k, setK] = useState(1);
  const [concurrency, setConcurrency] = useState(2);
  const [maxTurns, setMaxTurns] = useState(5);
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute total runs
  const selectedDataset = simDatasets.find(d => d._id === datasetId);
  const scenarioCount = selectedDataset?.scenarioCount ?? 0;
  const totalRuns = scenarioCount * k;

  async function handleStart() {
    if (!datasetId) return;
    setStarting(true);
    setError(null);
    try {
      const simId = await startSimulation({
        agentId,
        datasetId: datasetId as Id<"datasets">,
        k,
        concurrency,
        maxTurns,
        timeoutMs,
      });
      onCreated(simId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start simulation");
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-text">New Simulation</h2>
          <p className="text-xs text-text-dim mt-1">Configure and run a conversation simulation against this agent.</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Dataset */}
          <Field label="Scenario Dataset">
            <select
              value={datasetId}
              onChange={e => setDatasetId(e.target.value as Id<"datasets">)}
              className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
            >
              <option value="">Select dataset...</option>
              {simDatasets.map(ds => (
                <option key={ds._id} value={ds._id}>
                  {ds.name} ({ds.scenarioCount ?? 0} scenarios)
                </option>
              ))}
            </select>
          </Field>

          {/* k (passes per scenario) */}
          <Field label={`Passes per Scenario (k=${k})`}>
            <input
              type="range" min={1} max={5} value={k}
              onChange={e => setK(Number(e.target.value))}
              className="w-full accent-[#6ee7b7]"
            />
          </Field>

          {/* Advanced settings row */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Concurrency">
              <input
                type="number" min={1} max={10} value={concurrency}
                onChange={e => setConcurrency(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
            <Field label="Max Turns">
              <input
                type="number" min={5} max={50} value={maxTurns}
                onChange={e => setMaxTurns(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
            <Field label="Timeout (min)">
              <input
                type="number" min={1} max={10} value={timeoutMs / 60000}
                onChange={e => setTimeoutMs(Number(e.target.value) * 60000)}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
          </div>

          {/* Total runs display */}
          {datasetId && (
            <div className="bg-bg border border-border rounded-md p-3 text-xs">
              <div className="flex justify-between text-text-dim">
                <span>Scenarios: {scenarioCount}</span>
                <span>x {k} passes</span>
                <span>= <span className="text-accent font-medium">{totalRuns} total runs</span></span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!datasetId || starting}
            className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? "Starting..." : `Start Simulation (${totalRuns} runs)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}
