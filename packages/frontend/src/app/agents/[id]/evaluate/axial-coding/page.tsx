import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { agentSidebar } from "@/components/shell/sidebars";

export default async function AgentAxialCodingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Agent"
      sidebar={agentSidebar(id)}
      title="Axial coding"
      note="Failure modes over annotations. Moves here in the Agents section PR."
    />
  );
}
