"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { PodiumView } from "./PodiumView";
import { HeadToHeadView } from "./HeadToHeadView";
import { SoloScoreCard } from "./SoloScoreCard";
import { ResultsTable } from "./ResultsTable";

interface ExperimentResultsProps {
  runId: Id<"experimentRuns"> | null;
}

type RunStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed";

function StatusBadge({ status }: { status: RunStatus }) {
  const styleMap: Record<RunStatus, { bg: string; color: string; label: string }> = {
    pending: { bg: "rgba(234,179,8,0.12)", color: "#eab308", label: "Pending" },
    running: { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", label: "Running" },
    completed: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "Completed" },
    completed_with_errors: { bg: "rgba(249,115,22,0.12)", color: "#f97316", label: "Completed w/ errors" },
    failed: { bg: "rgba(239,68,68,0.12)", color: "#ef4444", label: "Failed" },
  };
  const s = styleMap[status] ?? { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: status };

  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: "4px",
        background: s.bg,
        color: s.color,
        letterSpacing: "0.04em",
      }}
    >
      {s.label}
    </span>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ExperimentResults({ runId }: ExperimentResultsProps) {
  const data = useQuery(
    api.experimentRuns.orchestration.getWithScores,
    runId ? { id: runId } : "skip",
  );

  // No run selected
  if (runId === null) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
        Select an experiment run to view results
      </div>
    );
  }

  // Loading
  if (data === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
        Loading…
      </div>
    );
  }

  // Not found / access denied
  if (data === null) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
        Run not found.
      </div>
    );
  }

  const status = data.status as RunStatus;
  const rankedResults = data.rankedResults;

  // Build formula string
  const w = data.scoringWeights;
  const formula = `${w.recall} × Recall + ${w.precision} × Precision`;

  // Completed results for choosing visualization
  const completedResults = rankedResults.filter(
    (r) => r.status === "completed" || r.status === "completed_with_errors",
  );
  const completedCount = completedResults.length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div
        className="px-5 py-4 flex flex-col gap-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text)" }}>
            {data.name}
          </span>
          <StatusBadge status={status} />
        </div>
        <div
          className="flex items-center gap-4 flex-wrap"
          style={{ fontSize: "11px", color: "var(--color-text-muted)" }}
        >
          <span>
            Dataset:{" "}
            <span style={{ color: "var(--color-text-dim)" }}>{data.datasetName}</span>
            {" · "}
            <span style={{ color: "var(--color-text-dim)" }}>{data.questionCount} questions</span>
          </span>
          <span>{formatDate(data.createdAt)}</span>
          <span className="font-mono" style={{ color: "var(--color-text-muted)" }}>
            Score = {formula}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-6 px-5 py-5">
        {/* Visualization */}
        {completedCount === 0 ? (
          /* Run exists but nothing completed yet */
          <div
            className="flex flex-col items-center justify-center gap-2 py-10"
            style={{
              border: "1px dashed var(--color-border)",
              borderRadius: "8px",
            }}
          >
            {status === "running" || status === "pending" ? (
              <>
                <span style={{ fontSize: "13px", color: "var(--color-text-dim)" }}>
                  Evaluation in progress…
                </span>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  {data.completedRetrievers} / {data.totalRetrievers} retrievers done
                </span>
              </>
            ) : (
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                No results available
              </span>
            )}
          </div>
        ) : completedCount === 1 ? (
          <SoloScoreCard result={completedResults[0]!} formula={formula} />
        ) : completedCount === 2 ? (
          <HeadToHeadView winner={completedResults[0]!} loser={completedResults[1]!} formula={formula} />
        ) : (
          <PodiumView results={completedResults} formula={formula} />
        )}

        {/* Results table (all results, including running/failed) */}
        <ResultsTable results={rankedResults} metricNames={data.metricNames} />
      </div>
    </div>
  );
}
