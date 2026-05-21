import { EntityStubPage } from "@/components/shell/EntityStubPage";
import { kbSidebar } from "@/components/shell/sidebars";

export default async function KbRetrieverDetailPage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = await params;
  return (
    <EntityStubPage
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(id)}
      title={`Retriever ${rid}`}
      legacyHref="/retrievers"
      legacyLabel="Open legacy /retrievers"
      note="Retriever config + playground. Moves here in the Knowledge Base section PR."
    />
  );
}
