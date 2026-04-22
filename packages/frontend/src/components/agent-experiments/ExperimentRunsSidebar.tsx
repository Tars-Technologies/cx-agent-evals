"use client";

import type { Id } from "@convex/_generated/dataModel";

interface ExperimentRunsSidebarProps {
  experiments: Array<{
    _id: Id<"experiments">;
    name: string;
    datasetId: Id<"datasets">;
    agentId?: Id<"agents">;
    status: string;
    totalQuestions?: number;
    processedQuestions?: number;
    createdAt: number;
  }>;
  selectedRunId: Id<"experiments"> | null;
  onSelect: (id: Id<"experiments">) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const statusStyles: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400",
  running: "bg-yellow-500/20 text-yellow-400",
  pending: "bg-purple-500/20 text-purple-400",
  failed: "bg-red-500/20 text-red-400",
};

export function ExperimentRunsSidebar({
  experiments,
  selectedRunId,
  onSelect,
  collapsed,
  onToggleCollapse,
}: ExperimentRunsSidebarProps) {
  if (collapsed) {
    return <div />;
  }

  return (
    <div className="relative flex h-full flex-col bg-bg overflow-hidden">
      {/* Collapse button */}
      <button
        onClick={onToggleCollapse}
        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-bg-elevated border border-border text-text-dim hover:text-text transition-colors text-xs"
        title="Collapse sidebar"
      >
        «
      </button>

      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <span
          className="uppercase text-text-dim font-medium tracking-wider"
          style={{ fontSize: "9px" }}
        >
          Experiment Runs
        </span>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {experiments.map((experiment) => {
          const isSelected = experiment._id === selectedRunId;
          const statusStyle =
            statusStyles[experiment.status] ?? "bg-gray-500/20 text-gray-400";

          return (
            <button
              key={experiment._id}
              onClick={() => onSelect(experiment._id)}
              className={[
                "w-full text-left px-3 py-2 border-l-2 transition-colors",
                isSelected
                  ? "bg-accent/10 border-l-accent"
                  : "hover:bg-bg-elevated border-l-transparent",
              ].join(" ")}
            >
              {/* Experiment name */}
              <div
                className="text-text font-medium truncate"
                style={{ fontSize: "11px" }}
              >
                {experiment.name}
              </div>

              {/* Meta line */}
              <div
                className="flex items-center gap-1.5 mt-0.5"
                style={{ fontSize: "9px" }}
              >
                <span className="text-text-dim">
                  {experiment.processedQuestions !== undefined &&
                  experiment.totalQuestions !== undefined
                    ? `${experiment.processedQuestions}/${experiment.totalQuestions} questions`
                    : experiment.totalQuestions !== undefined
                      ? `${experiment.totalQuestions} questions`
                      : "—"}
                </span>
                <span
                  className={[
                    "rounded px-1 py-0.5 font-medium",
                    statusStyle,
                  ].join(" ")}
                >
                  {experiment.status}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
