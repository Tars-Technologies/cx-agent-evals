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
          const isRunning = sim.status === "running" || sim.status === "pending";
          const passRate = sim.overallPassRate != null ? `${(sim.overallPassRate * 100).toFixed(0)}%` : "\u2014";

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
              <div className="flex items-center justify-between">
                <span className="text-xs text-text font-medium truncate">
                  k={sim.k}
                </span>
                {isRunning ? (
                  <span className="flex items-center gap-1 text-[10px] text-accent">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    {sim.completedRuns}/{sim.totalRuns}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-accent">
                    {passRate}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-text-dim mt-0.5">
                {new Date(sim.startedAt ?? sim._creationTime).toLocaleDateString()} · {sim.totalRuns} runs
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
