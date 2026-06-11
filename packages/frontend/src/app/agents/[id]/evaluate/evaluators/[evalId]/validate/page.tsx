"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import Link from "next/link";

type Metrics = { tpr: number; tnr: number; agreement: number };
type CIPair = { tpr: { lower: number; upper: number }; tnr: { lower: number; upper: number } };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const range = (c?: { lower: number; upper: number }) =>
  c ? ` (${pct(c.lower)}–${pct(c.upper)})` : "";

function MetricRow({
  label,
  value,
  ci,
}: {
  label: string;
  value: number;
  ci?: { lower: number; upper: number };
}) {
  const p = Math.round(value * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-dim">{label}</span>
        <span className="font-mono text-text font-medium">
          {pct(value)}
          {ci && <span className="text-text-dim font-normal">{range(ci)}</span>}
        </span>
      </div>
      <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            p >= 85 ? "bg-green-400" : p >= 70 ? "bg-yellow-400" : "bg-red-400"
          }`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

function MetricGroup({
  title,
  metrics,
  ci,
  emptyLabel,
}: {
  title: string;
  metrics: Metrics | null | undefined;
  ci?: CIPair;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-text-dim font-medium">
        {title}
      </div>
      {!metrics ? (
        <p className="text-xs text-text-dim">{emptyLabel}</p>
      ) : (
        <>
          <MetricRow label="TPR (true positive rate)" value={metrics.tpr} ci={ci?.tpr} />
          <MetricRow label="TNR (true negative rate)" value={metrics.tnr} ci={ci?.tnr} />
          <MetricRow label="Agreement" value={metrics.agreement} />
        </>
      )}
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
  // We only keep the action return for the immediate calibrating/needed banner.
  // Metrics + CIs are read reactively from the persisted evaluator doc.
  const [lastRun, setLastRun] = useState<{
    status: "ready" | "validated" | "calibrating";
    reason?: "insufficient_labels";
    needed?: { pass: number; fail: number };
  } | null>(null);

  const labelsBase = `/agents/${agentId}/evaluate/evaluators/${evalId}?tab=labels`;

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    setLastRun(null);
    try {
      const result = await runValidation({ evaluatorId: evalId });
      setLastRun({ status: result.status, reason: result.reason, needed: result.needed });
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
  const status = evaluator.status;
  const hasResult = Boolean(evaluator.devMetrics);
  const calibrating =
    lastRun?.status === "calibrating" && lastRun.reason === "insufficient_labels";

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text mb-1">Validate evaluator</h3>
        <p className="text-xs text-text-dim">
          Score the evaluator against held-out labels to measure TPR, TNR, and agreement
          on the dev (tuning) and test (held-out) splits.
        </p>
      </div>

      {/* Calibrating / insufficient labels banner */}
      {calibrating && lastRun?.needed && (
        <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-lg p-4 space-y-2">
          <p className="text-xs text-yellow-300 leading-relaxed">
            Need {lastRun.needed.pass} more Pass and {lastRun.needed.fail} more Fail
            label(s) on the final split before this judge can be marked ready.
          </p>
          <Link
            href={labelsBase}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Go to Labels tab →
          </Link>
        </div>
      )}

      {/* Persisted metrics (reactive from crud.get) */}
      {hasResult && (
        <div className="border border-border rounded-lg p-4 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text">Validation result</p>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                status === "ready"
                  ? "bg-green-500/15 text-green-400"
                  : status === "calibrating"
                    ? "bg-yellow-500/15 text-yellow-400"
                    : "bg-accent/15 text-accent"
              }`}
            >
              {status}
            </span>
          </div>

          <MetricGroup
            title="Dev (tuning)"
            metrics={evaluator.devMetrics}
            ci={evaluator.devMetricsCI}
            emptyLabel="No dev labels yet"
          />

          <div className="border-t border-border" />

          <MetricGroup
            title="Test (held-out)"
            metrics={evaluator.testMetrics}
            ci={evaluator.testMetricsCI}
            emptyLabel="No test labels yet"
          />

          {status === "ready" && (
            <p className="text-[10px] text-green-400">
              Thresholds met (TPR ≥ 85%, TNR ≥ 85%). Evaluator is ready.
            </p>
          )}
          {status === "calibrating" && !calibrating && (
            <p className="text-[10px] text-yellow-400">
              Still calibrating — add more labels per class, then re-validate.
            </p>
          )}
        </div>
      )}

      {/* Dev labels gate / run button */}
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
