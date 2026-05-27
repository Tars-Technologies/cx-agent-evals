"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
  const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
  const startSimulation = useMutation(api.conversationSim.orchestration.start);

  const [scenarioSetId, setScenarioSetId] =
    useState<Id<"scenarioSets"> | null>(null);
  const [k, setK] = useState(1);
  const [maxTurns, setMaxTurns] = useState(5);
  const [concurrency, setConcurrency] = useState(2);
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const selectedSet = sets?.find((s) => s._id === scenarioSetId) ?? null;
  const totalRuns = selectedSet ? selectedSet.scenarioCount * k : 0;

  async function handleStart() {
    if (!scenarioSetId) return;
    setStarting(true);
    setError(null);
    try {
      const id = await startSimulation({
        agentId,
        scenarioSetId,
        k,
        maxTurns,
        concurrency,
        timeoutMs,
      });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-text">New simulation</h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="Scenario set">
            {sets === undefined ? (
              <div className="text-[11px] text-text-dim">Loading…</div>
            ) : sets.length === 0 ? (
              <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
                Generate a scenario set first.
              </div>
            ) : (
              <select
                value={scenarioSetId ?? ""}
                onChange={(e) =>
                  setScenarioSetId(
                    e.target.value
                      ? (e.target.value as Id<"scenarioSets">)
                      : null,
                  )
                }
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              >
                <option value="">Select a set…</option>
                {sets.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.scenarioCount} scenarios)
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`k (runs per scenario): ${k}`}>
              <input
                type="range"
                min={1}
                max={5}
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
                className="w-full accent-[#6ee7b7]"
              />
            </Field>
            <Field label="Max turns">
              <input
                type="number"
                min={1}
                max={50}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
            <Field label="Concurrency">
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
            <Field label="Timeout (min)">
              <input
                type="number"
                min={1}
                max={10}
                value={Math.round(timeoutMs / 60000)}
                onChange={(e) =>
                  setTimeoutMs(Number(e.target.value) * 60000)
                }
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </Field>
          </div>

          {selectedSet && (
            <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
              Total runs: <span className="text-text">{totalRuns}</span> (
              {selectedSet.scenarioCount} scenarios × {k})
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!scenarioSetId || starting}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? "Starting…" : "Start simulation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
