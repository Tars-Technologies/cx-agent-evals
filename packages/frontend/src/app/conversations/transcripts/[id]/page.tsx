// TODO(annotation): Add AnnotationSidePanel pencil here once the transcript
// detail view is built out. The current page is a stub and—more importantly—
// `/conversations/transcripts/[id]` is NOT agent-scoped, while
// `AnnotationSidePanel` requires an `agentId` (annotations are agent-scoped
// via auto-container resolution). When this view is fleshed out, either:
//   1. Move the transcript viewer under an agent-scoped path (e.g.
//      `/agents/[id]/conversations/transcripts/[tid]`), or
//   2. Prompt the user to pick an agent before opening the annotate panel.
// Origin hint: { kind: "upload", uploadId: transcript.uploadId }
// conversationRef: { kind: "transcript", transcriptId: transcript._id }
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
