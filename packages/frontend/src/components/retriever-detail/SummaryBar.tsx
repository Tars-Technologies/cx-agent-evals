"use client";

import Link from "next/link";

interface SummaryBarProps {
  retrieverName: string;
  experimentName: string;
  datasetName: string;
  questionCount: number;
  scores: Record<string, number>;
  metricNames: string[];
  backHref: string;
  configChip?: string;
  status: string;
  phase?: string | null;
  totalQuestions?: number | null;
  processedQuestions?: number | null;
}

const RUNNING_STATUSES = new Set(["pending", "running"]);

function RunningBadge({
  phase,
  processed,
  total,
}: {
  phase: string | null | undefined;
  processed: number | null | undefined;
  total: number | null | undefined;
}) {
  let label: string;
  if (phase && phase !== "evaluating" && phase !== "done") {
    label = phase[0]!.toUpperCase() + phase.slice(1) + "…";
  } else if (total && total > 0) {
    label = `${processed ?? 0} / ${total} questions`;
  } else {
    label = "Running…";
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded"
      style={{
        background: "rgba(59,130,246,0.12)",
        color: "#3b82f6",
        fontSize: "11px",
        fontWeight: 600,
      }}
    >
      <span
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: "#3b82f6",
          animation: "pulse-dot 1.4s ease-in-out infinite",
        }}
      />
      {label}
    </span>
  );
}

function MetricChip({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded"
      style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <span style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </span>
      <span className="tabular-nums" style={{ fontSize: "12px", color: "var(--color-text)", fontWeight: 600 }}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

export function SummaryBar({
  retrieverName,
  experimentName,
  datasetName,
  questionCount,
  scores,
  metricNames,
  backHref,
  configChip,
  status,
  phase,
  totalQuestions,
  processedQuestions,
}: SummaryBarProps) {
  const showF1 = metricNames.includes("f1");
  const showIoU = metricNames.includes("iou");
  const isRunning = RUNNING_STATUSES.has(status);

  return (
    <div
      className="flex items-center gap-4 px-5 py-3 sticky top-0 z-10"
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
    >
      <Link
        href={backHref}
        className="text-text-dim hover:text-text transition-colors"
        style={{ fontSize: "12px" }}
      >
        ← Back
      </Link>

      <div className="w-px h-5" style={{ background: "var(--color-border)" }} />

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>
            {retrieverName}
          </span>
          {isRunning && (
            <RunningBadge
              phase={phase}
              processed={processedQuestions}
              total={totalQuestions}
            />
          )}
        </div>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {experimentName} · {datasetName} · {questionCount} questions
          {configChip ? <> · <span className="font-mono">{configChip}</span></> : null}
        </span>
      </div>

      <div className="flex-1" />

      {!isRunning && (
        <div className="flex items-center gap-2 flex-wrap">
          <MetricChip label="Recall" value={scores.recall} />
          <MetricChip label="Precision" value={scores.precision} />
          {showF1 && <MetricChip label="F1" value={scores.f1} />}
          {showIoU && <MetricChip label="IoU" value={scores.iou} />}
        </div>
      )}
    </div>
  );
}
