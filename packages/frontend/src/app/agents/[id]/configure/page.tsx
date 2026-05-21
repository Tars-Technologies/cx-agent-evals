import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { agentSidebar } from "@/components/shell/sidebars";

export default async function AgentConfigurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Agent"
      sidebar={agentSidebar(id)}
      title="Configure"
      legacyHref="/agents"
      legacyLabel="Open legacy /agents"
      note="Agent config + playground. Moves here in the Agents section PR."
    />
  );
}
