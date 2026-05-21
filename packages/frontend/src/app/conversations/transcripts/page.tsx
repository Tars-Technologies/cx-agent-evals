import { TabsLayout } from "@/components/shell/TabsLayout";
import { StubPanel } from "@/components/shell/StubPanel";

export default function ConversationsTranscriptsPage() {
  return (
    <TabsLayout
      title="Conversations"
      tabs={[
        { label: "Real conversations", href: "/conversations" },
        { label: "Transcripts", href: "/conversations/transcripts" },
      ]}
    >
      <StubPanel
        title="Transcripts"
        note="Upload + analyze conversation transcripts. Moves over in the Conversations section PR."
      />
    </TabsLayout>
  );
}
