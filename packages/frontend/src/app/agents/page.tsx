"use client";

import { Suspense, useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import AgentSidebar from "@/components/AgentSidebar";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";

function AgentsContent() {
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);

  return (
    <div className="h-screen flex flex-col bg-bg">
      <Header mode="agents" />
      <div className="flex flex-1 min-h-0">
        <AgentSidebar
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {selectedAgentId ? (
            <>
              {/* Context bar */}
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2.5">
                <span className="text-text text-sm font-semibold">Agent Config & Playground</span>
              </div>
              {/* Two-column: Config + Playground */}
              <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0">
                <div className="border-r border-border overflow-y-auto">
                  <AgentConfigPanel agentId={selectedAgentId} />
                </div>
                <AgentPlayground agentId={selectedAgentId} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-text-muted text-sm">Select an agent or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
