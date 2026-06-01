"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function ScorecardPanel({
  agentId,
  simulationId,
}: {
  agentId: Id<"agents">;
  simulationId: Id<"conversationSimulations">;
}) {
  const card = useQuery(api.evaluator.evaluationRuns.scorecardBySimulation, {
    simulationId,
  });
  const readyEvaluators = useQuery(api.evaluator.crud.byAgentStatus, {
    agentId,
    status: "ready",
  });
  const runOnCohort = useAction(api.evaluator.batchApply.runOnCohort);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  const handleRun = async () => {
    if (!readyEvaluators || readyEvaluators.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      await runOnCohort({
        evaluatorIds: readyEvaluators.map((e) => e._id),
        cohort: { kind: "simulation", simulationId },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run scorecard");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-elevated/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Agent scorecard</h3>
        <button
          onClick={handleRun}
          disabled={running || !readyEvaluators || readyEvaluators.length === 0}
          className="text-xs rounded border border-border px-2 py-1 hover:bg-bg-surface transition-colors disabled:opacity-50"
          title={
            readyEvaluators && readyEvaluators.length === 0
              ? "No ready (validated) judges yet"
              : undefined
          }
        >
          {running ? "Running…" : "Run scorecard"}
        </button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {card && card.rows.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm text-text">
            Overall (corrected):{" "}
            <span className="font-semibold font-mono">
              {pct(card.overall.correctedPassRate)}
            </span>
          </div>
          <ul className="space-y-1">
            {card.rows.map((r) => (
              <li
                key={r.evaluatorId}
                className="text-xs flex items-center justify-between gap-2"
              >
                <span className="text-text">{r.name}</span>
                <span className="text-text-dim font-mono">
                  {/* Only show a CI range for corrected rows; uncorrected rows
                      carry a vacuous {0,1} CI which would read as a real 0%–100%
                      interval. */}
                  {r.corrected
                    ? `${pct(r.correctedPassRate)} (${pct(r.ci.lower)}–${pct(r.ci.upper)})`
                    : pct(r.observedPassRate)}
                  , n={r.n}
                  {!r.corrected && (
                    <span
                      className="ml-2 text-amber-400"
                      title="Judge not validated — uncorrected"
                    >
                      ⚠ uncorrected
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-xs text-text-dim">
          No scorecard yet. Run ready judges across this simulation’s conversations.
        </div>
      )}
    </div>
  );
}
