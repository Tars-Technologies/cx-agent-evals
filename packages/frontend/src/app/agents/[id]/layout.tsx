"use client";

import { useParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { agentSidebar } from "@/components/shell/sidebars";
import { useAgentBreadcrumb } from "@/lib/useAgentBreadcrumb";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;
  const { agent, labelOverrides } = useAgentBreadcrumb(agentId);

  return (
    <EntityDetailLayout
      sidebar={agentSidebar(agentId)}
      breadcrumbs={[
        { label: "Agents", href: "/agents" },
        { label: agent?.name ?? agentId, href: `/agents/${agentId}/configure` },
      ]}
      breadcrumbLabelOverrides={labelOverrides}
    >
      {children}
    </EntityDetailLayout>
  );
}
