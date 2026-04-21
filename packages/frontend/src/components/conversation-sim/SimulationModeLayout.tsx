"use client";

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { SimulationsSidebar } from "./SimulationsSidebar";
import { SimScenarioList } from "./SimScenarioList";
import { SimRunDetail } from "./SimRunDetail";
import { ResizablePanel } from "@/components/ResizablePanel";

export function SimulationModeLayout({
  agentId,
  showCreateModal,
  onCloseCreateModal,
}: {
  agentId: Id<"agents">;
  showCreateModal: boolean;
  onCloseCreateModal: () => void;
}) {
  const [selectedSimId, setSelectedSimId] = useState<Id<"conversationSimulations"> | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<Id<"conversationSimRuns"> | null>(null);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Simulations sidebar */}
      <ResizablePanel storageKey="sim-sidebar" defaultWidth={220} minWidth={160} maxWidth={350}>
        <div className="h-full border-r border-border bg-bg">
          <SimulationsSidebar
            agentId={agentId}
            selectedId={selectedSimId}
            onSelect={(id) => {
              setSelectedSimId(id);
              setSelectedRunId(null);
            }}
          />
        </div>
      </ResizablePanel>

      {/* Middle: Scenario/Run list */}
      {selectedSimId ? (
        <ResizablePanel storageKey="sim-scenarios" defaultWidth={280} minWidth={200} maxWidth={450}>
          <div className="h-full border-r border-border bg-bg">
            <SimScenarioList
              simulationId={selectedSimId}
              selectedRunId={selectedRunId}
              onSelectRun={setSelectedRunId}
            />
          </div>
        </ResizablePanel>
      ) : (
        <div className="w-[280px] border-r border-border flex items-center justify-center text-text-dim text-xs">
          Select a simulation
        </div>
      )}

      {/* Right: Run detail */}
      <div className="flex-1 min-w-0 bg-bg overflow-hidden">
        {selectedRunId ? (
          <SimRunDetail runId={selectedRunId} />
        ) : (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            Select a run to view details
          </div>
        )}
      </div>
    </div>
  );
}
