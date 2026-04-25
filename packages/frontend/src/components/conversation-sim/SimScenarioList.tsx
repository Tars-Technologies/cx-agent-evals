"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function SimScenarioList({
  simulationId,
  selectedRunId,
  onSelectRun,
}: {
  simulationId: Id<"conversationSimulations">;
  selectedRunId: Id<"conversationSimRuns"> | null;
  onSelectRun: (id: Id<"conversationSimRuns">) => void;
}) {
  const runs = useQuery(
    api.conversationSim.runs.bySimulation,
    { simulationId },
  ) ?? [];

  // Group runs by scenarioId
  const grouped = new Map<string, typeof runs>();
  for (const run of runs) {
    const key = run.scenarioId as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(run);
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        No runs yet
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">
          Scenarios ({grouped.size})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([scenarioId, scenarioRuns]) => {
          const allPassed = scenarioRuns.every(r => r.passed);
          const isSelected = scenarioRuns.some(r => r._id === selectedRunId);

          return (
            <div
              key={scenarioId}
              onClick={() => onSelectRun(scenarioRuns[0]._id)}
              className={`border-b border-border cursor-pointer transition-colors ${
                isSelected ? "bg-accent/5" : "hover:bg-bg-elevated/50"
              }`}
            >
              {/* Scenario header */}
              <div className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text font-medium truncate">
                    Scenario
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    allPassed
                      ? "bg-green-500/15 text-green-400"
                      : "bg-red-500/15 text-red-400"
                  }`}>
                    {allPassed ? "PASS" : "FAIL"}
                  </span>
                </div>
                {/* Run dots */}
                <div className="flex gap-1.5 mt-1.5">
                  {scenarioRuns.map((run, i) => (
                    <button
                      key={run._id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRun(run._id);
                      }}
                      className={`group flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                        run._id === selectedRunId
                          ? "bg-accent/20 text-accent"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${
                        run.status === "running" || run.status === "pending"
                          ? "bg-accent animate-pulse"
                          : run.passed
                            ? "bg-green-400"
                            : "bg-red-400"
                      }`} />
                      Run {i + 1}
                      {run.score != null && (
                        <span className="text-text-dim">{(run.score * 100).toFixed(0)}%</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
