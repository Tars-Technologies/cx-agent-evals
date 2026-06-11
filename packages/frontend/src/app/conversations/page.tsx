import { TabsLayout } from "@/components/shell/TabsLayout";
import { RealConversationsPane } from "@/components/conversations/RealConversationsPane";
import { TranscriptsPane } from "@/components/conversations/TranscriptsPane";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; id?: string }>;
}) {
  const { tab, id } = await searchParams;
  const activeTab = tab === "transcripts" ? "transcripts" : "real";

  return (
    <TabsLayout
      title="Conversations"
      tabs={[
        { label: "Real conversations", value: "real" },
        { label: "Transcripts", value: "transcripts" },
      ]}
    >
      {activeTab === "real" ? (
        <RealConversationsPane selectedId={id} />
      ) : (
        <TranscriptsPane selectedId={id} />
      )}
    </TabsLayout>
  );
}
