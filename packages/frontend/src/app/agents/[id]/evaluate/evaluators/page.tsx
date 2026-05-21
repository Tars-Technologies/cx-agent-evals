import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { agentSidebar } from "@/components/shell/sidebars";

export default async function AgentEvaluatorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Agent"
      sidebar={agentSidebar(id)}
      title="Evaluators"
      legacyHref="/evaluators"
      legacyLabel="Open legacy /evaluators"
    />
  );
}
