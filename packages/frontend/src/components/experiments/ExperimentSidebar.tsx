"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface ExperimentSidebarProps {
  kbId: Id<"knowledgeBases">;
  selectedRunId: Id<"experimentRuns"> | null;
  onSelect: (runId: Id<"experimentRuns">) => void;
}

type RunStatus = "pending" | "running" | "completed" | "completed_with_errors" | "failed";

function StatusDot({ status }: { status: RunStatus }) {
  const colorMap: Record<RunStatus, string> = {
    completed: "#22c55e",
    running: "#3b82f6",
    failed: "#ef4444",
    pending: "#eab308",
    completed_with_errors: "#f97316",
  };
  const color = colorMap[status] ?? "#6b7280";

  return (
    <span
      style={{
        display: "inline-block",
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ExperimentSidebar({ kbId, selectedRunId, onSelect }: ExperimentSidebarProps) {
  const runs = useQuery(api.experimentRuns.orchestration.byKb, { kbId });

  return (
    <div
      className="flex flex-col overflow-y-auto"
      style={{
        borderRight: "1px solid var(--color-border)",
        minWidth: "220px",
        maxWidth: "280px",
        width: "260px",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-3"
        style={{
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Experiment Runs
        </span>
      </div>

      {/* Run list */}
      {runs === undefined ? (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
        >
          Loading…
        </div>
      ) : runs.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-center px-4"
          style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
        >
          No experiments yet
        </div>
      ) : (
        <ul className="flex flex-col">
          {runs.map((run) => {
            const isSelected = run._id === selectedRunId;
            const status = run.status as RunStatus;

            return (
              <li key={run._id}>
                <button
                  onClick={() => onSelect(run._id)}
                  className="w-full text-left flex flex-col gap-1 px-3 py-3"
                  style={{
                    background: isSelected
                      ? "var(--color-bg-elevated)"
                      : "transparent",
                    borderLeft: isSelected
                      ? "3px solid var(--color-accent)"
                      : "3px solid transparent",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                >
                  {/* Row 1: name + status dot */}
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={status} />
                    <span
                      className="truncate flex-1"
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text)",
                        fontWeight: 500,
                      }}
                      title={run.name}
                    >
                      {run.name}
                    </span>
                  </div>

                  {/* Row 2: retrievers count + date */}
                  <div
                    className="flex items-center justify-between gap-2"
                    style={{ fontSize: "10px", color: "var(--color-text-muted)" }}
                  >
                    <span>
                      {run.retrieverIds.length}{" "}
                      {run.retrieverIds.length === 1 ? "retriever" : "retrievers"}
                    </span>
                    <span>{formatDate(run.createdAt)}</span>
                  </div>

                  {/* Row 3: winner (if completed) */}
                  {(status === "completed" || status === "completed_with_errors") &&
                    run.winnerName !== undefined &&
                    run.winnerScore !== undefined && (
                      <div
                        className="flex items-center gap-1 truncate"
                        style={{ fontSize: "10px", color: "var(--color-accent)" }}
                      >
                        <span>★</span>
                        <span className="truncate" title={run.winnerName}>
                          {run.winnerName}
                        </span>
                        <span className="tabular-nums" style={{ flexShrink: 0 }}>
                          {(run.winnerScore * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
