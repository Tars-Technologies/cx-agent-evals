import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { kbSidebar } from "@/components/shell/sidebars";

export default async function KbExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(id)}
      title="Experiments"
      legacyHref="/experiments"
      legacyLabel="Open legacy /experiments"
      note="Retriever experiment runs. Moves here in the Knowledge Base section PR."
    />
  );
}
