import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { agentSidebar } from "@/components/shell/sidebars";

export default async function AgentExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Agent"
      sidebar={agentSidebar(id)}
      title="Experiments"
      legacyHref="/agents"
      legacyLabel="Open legacy /agents"
      note="Scenario simulations. Moves here in the Agents section PR."
    />
  );
}
