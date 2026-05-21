import { TopBar } from "@/components/shell/TopBar";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { StubPanel } from "@/components/shell/StubPanel";

export default async function TranscriptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <div className="mb-4">
          <Breadcrumbs labelOverrides={{ [id]: id }} />
        </div>
        <StubPanel
          title={`Transcript ${id}`}
          note="Transcript detail view. Moves over in the Conversations section PR."
        />
      </main>
    </div>
  );
}
