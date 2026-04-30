"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function SimulationsSidebar({
  agentId,
  selectedId,
  onSelect,
}: {
  agentId: Id<"agents">;
  selectedId: Id<"conversationSimulations"> | null;
  onSelect: (id: Id<"conversationSimulations">) => void;
}) {
  const simulations = useQuery(
    api.conversationSim.orchestration.byAgent,
    { agentId },
  ) ?? [];

  if (simulations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        No simulations yet
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">Simulations</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {simulations.map(sim => {
          return (
            <div
              key={sim._id}
              onClick={() => onSelect(sim._id)}
              className={`px-3 py-2.5 border-b border-border cursor-pointer transition-colors ${
                selectedId === sim._id
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-bg-elevated/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="text-xs text-text font-medium truncate">
                  k={sim.k}
                </span>
                <div className="text-[10px] text-right space-y-0.5">
                  <div className={
                    sim.status === "completed" ? "text-green-400 font-medium" :
                    sim.status === "running" || sim.status === "pending" ? "text-accent" :
                    sim.status === "cancelled" ? "text-yellow-400" :
                    "text-text-dim"
                  }>
                    {sim.status === "completed"
                      ? `✓ ${sim.totalRuns} convos`
                      : sim.status === "running" || sim.status === "pending"
                        ? `${sim.completedRuns + (sim.failedRuns ?? 0)}/${sim.totalRuns} convos`
                        : sim.status === "cancelled"
                          ? `Cancelled · ${sim.completedRuns} convos`
                          : sim.status === "failed"
                            ? `Failed · ${sim.failedRuns ?? 0}/${sim.totalRuns}`
                            : `${sim.totalRuns} runs`
                    }
                  </div>
                  <div className="text-text-dim">
                    {sim.evaluationStatus === "completed"
                      ? sim.overallPassRate != null
                        ? `${(sim.overallPassRate * 100).toFixed(0)}% passed`
                        : "Evaluated"
                      : sim.evaluationStatus === "running"
                        ? `Evaluating ${sim.evaluationCompletedRuns ?? 0}/${sim.totalRuns}`
                        : sim.evaluationStatus === "failed"
                          ? "Eval failed"
                          : "Not evaluated"
                    }
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-text-dim mt-1">
                {new Date(sim.startedAt ?? sim._creationTime).toLocaleDateString()} · {sim.totalRuns} runs
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
