"use client";

import { useParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { agentRunSidebar } from "@/components/shell/sidebars";
import { useAgentBreadcrumb } from "@/lib/useAgentBreadcrumb";

export default function AgentRunLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string; runId: string }>();
  const agentId = params.id as Id<"agents">;
  const runId = params.runId;
  const { agent, labelOverrides } = useAgentBreadcrumb(agentId);

  return (
    <EntityDetailLayout
      sidebar={agentRunSidebar(agentId, runId)}
      breadcrumbs={[
        { label: "Agents", href: "/agents" },
        { label: agent?.name ?? agentId, href: `/agents/${agentId}/configure` },
        { label: "Experiments", href: `/agents/${agentId}/evaluate/experiments` },
        { label: `Run ${runId.slice(-6)}`, href: `/agents/${agentId}/evaluate/experiments/${runId}` },
      ]}
      breadcrumbLabelOverrides={labelOverrides}
    >
      {children}
    </EntityDetailLayout>
  );
}
