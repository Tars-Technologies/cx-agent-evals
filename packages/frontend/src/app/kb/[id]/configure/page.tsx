import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { kbSidebar } from "@/components/shell/sidebars";

export default async function KbConfigurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(id)}
      title="Configure"
      legacyHref="/kb"
      legacyLabel="Open legacy /kb"
      note="Docs + indexing playground. Moves here in the Knowledge Base section PR."
    />
  );
}
