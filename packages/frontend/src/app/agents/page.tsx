"use client";

import { Suspense, useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import AgentSidebar from "@/components/AgentSidebar";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";
import { ExperimentModeLayout } from "@/components/agent-experiments/ExperimentModeLayout";

function AgentsPageContent() {
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);
  const [pageMode, setPageMode] = useState<"create" | "experiment">("create");

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <Header mode="agents" />
      {/* Top bar with mode toggle */}
      <div className="flex items-center gap-3 border-b border-border bg-bg-elevated px-6 py-2.5">
        <span className="text-accent font-semibold text-sm">Agents</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              pageMode === "create" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
            }`}
            onClick={() => setPageMode("create")}
          >
            Create
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              pageMode === "experiment" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
            }`}
            onClick={() => setPageMode("experiment")}
          >
            Experiment
          </button>
        </div>
      </div>

      {/* Mode content */}
      {pageMode === "create" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <AgentSidebar
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
          {selectedAgentId ? (
            <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0 min-w-0">
              <div className="border-r border-border flex flex-col min-h-0">
                <AgentConfigPanel agentId={selectedAgentId} />
              </div>
              <AgentPlayground agentId={selectedAgentId} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-text-muted text-sm">Select an agent or create a new one</p>
            </div>
          )}
        </div>
      ) : (
        <ExperimentModeLayout />
      )}
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg" />}>
      <AgentsPageContent />
    </Suspense>
  );
}
