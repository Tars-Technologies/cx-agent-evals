import { TabsLayout } from "@/components/shell/TabsLayout";
import { StubPanel } from "@/components/shell/StubPanel";

export default function ConversationsRealPage() {
  return (
    <TabsLayout
      title="Conversations"
      tabs={[
        { label: "Real conversations", href: "/conversations" },
        { label: "Transcripts", href: "/conversations/transcripts" },
      ]}
    >
      <StubPanel
        title="Real conversations"
        note="Live agent chat sessions will appear here. Moves over in the Conversations section PR."
      />
    </TabsLayout>
  );
}
