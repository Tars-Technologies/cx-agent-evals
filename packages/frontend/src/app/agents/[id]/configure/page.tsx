"use client";
import { useParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";

export default function ConfigurePage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;

  return (
    <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0 min-w-0 overflow-hidden">
      <div className="border-r border-border overflow-y-auto">
        <AgentConfigPanel agentId={agentId} />
      </div>
      <AgentPlayground agentId={agentId} />
    </div>
  );
}
