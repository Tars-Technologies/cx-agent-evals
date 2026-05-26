"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import Link from "next/link";

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-dim">{label}</span>
        <span className="font-mono text-text font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct >= 85 ? "bg-green-400" : pct >= 70 ? "bg-yellow-400" : "bg-red-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ValidatePage() {
  const params = useParams<{ id: string; evalId: string }>();
  const agentId = params.id;
  const evalId = params.evalId as Id<"evaluators">;

  const evaluator = useQuery(api.evaluator.crud.get, { id: evalId });
  const counts = useQuery(api.evaluator.labels.counts, { evaluatorId: evalId });

  const runValidation = useAction(api.evaluator.validate.run);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    tpr: number;
    tnr: number;
    agreement: number;
    status: string;
    skipped: number;
  } | null>(null);

  const labelsBase = `/agents/${agentId}/evaluate/evaluators/${evalId}?tab=labels`;

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    setLastResult(null);
    try {
      const result = await runValidation({ evaluatorId: evalId });
      setLastResult(result as {
        tpr: number;
        tnr: number;
        agreement: number;
        status: string;
        skipped: number;
      });
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setRunning(false);
    }
  }

  if (evaluator === undefined || counts === undefined) {
    return (
      <div className="space-y-3 max-w-md">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded bg-bg-elevated border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  const hasDevLabels = counts.dev > 0;

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text mb-1">Validate evaluator</h3>
        <p className="text-xs text-text-dim">
          Run the evaluator against dev-split labels to measure TPR, TNR, and agreement.
        </p>
      </div>

      {/* Existing metrics (from last validate run) */}
      {evaluator.devMetrics && !lastResult && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text">Last validation result</p>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                evaluator.status === "ready"
                  ? "bg-green-500/15 text-green-400"
                  : "bg-accent/15 text-accent"
              }`}
            >
              {evaluator.status}
            </span>
          </div>
          <MetricBar label="TPR (true positive rate)" value={evaluator.devMetrics.tpr} />
          <MetricBar label="TNR (true negative rate)" value={evaluator.devMetrics.tnr} />
          <MetricBar label="Agreement" value={evaluator.devMetrics.agreement} />
        </div>
      )}

      {/* Latest run result (reactive) */}
      {lastResult && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text">Validation result</p>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                lastResult.status === "ready"
                  ? "bg-green-500/15 text-green-400"
                  : "bg-accent/15 text-accent"
              }`}
            >
              {lastResult.status}
            </span>
          </div>
          <MetricBar label="TPR (true positive rate)" value={lastResult.tpr} />
          <MetricBar label="TNR (true negative rate)" value={lastResult.tnr} />
          <MetricBar label="Agreement" value={lastResult.agreement} />
          {lastResult.skipped > 0 && (
            <p className="text-[10px] text-text-dim">
              {lastResult.skipped} transcript-sourced labels were skipped.
            </p>
          )}
          {lastResult.status === "ready" ? (
            <p className="text-[10px] text-green-400">
              Thresholds met (TPR ≥ 85%, TNR ≥ 85%). Evaluator is ready.
            </p>
          ) : (
            <p className="text-[10px] text-yellow-400">
              Below threshold. Add more labels and calibrate, then re-validate.
            </p>
          )}
        </div>
      )}

      {/* Dev labels gate */}
      {!hasDevLabels ? (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <p className="text-xs text-text-dim">
            No dev labels yet — calibrate this evaluator first.
          </p>
          <Link
            href={labelsBase}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Go to Labels tab →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            {counts.dev} dev label{counts.dev !== 1 ? "s" : ""} available.
          </p>
          {runError && <p className="text-xs text-red-400">{runError}</p>}
          <button
            onClick={handleRun}
            disabled={running}
            className="px-4 py-2 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {running ? "Running validation…" : "Run validation"}
          </button>
        </div>
      )}
    </div>
  );
}
