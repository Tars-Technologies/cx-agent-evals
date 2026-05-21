import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { agentSidebar } from "@/components/shell/sidebars";

export default async function AgentOpenCodingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Agent"
      sidebar={agentSidebar(id)}
      title="Open coding"
      note="Annotate scenario-run conversations. Moves here in the Agents section PR."
    />
  );
}
