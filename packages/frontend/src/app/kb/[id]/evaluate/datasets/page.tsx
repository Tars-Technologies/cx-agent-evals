import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { kbSidebar } from "@/components/shell/sidebars";

export default async function KbDatasetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(id)}
      title="Datasets"
      legacyHref="/dataset"
      legacyLabel="Open legacy /dataset"
    />
  );
}
