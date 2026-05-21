"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { TabBar } from "@/components/livechat/TabBar";
import { StatsTab } from "@/components/livechat/StatsTab";
import { ConversationsTab } from "@/components/livechat/ConversationsTab";
import type { LivechatTab, BasicStats } from "@/components/livechat/types";

export function TranscriptDetail({ uploadId }: { uploadId: Id<"livechatUploads"> }) {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const upload = useQuery(api.livechat.orchestration.get, { id: uploadId });

  if (upload === undefined) {
    return <div className="p-6 text-xs text-text-dim">Loading transcript…</div>;
  }
  if (upload === null) {
    return <div className="p-6 text-xs text-red-400">Transcript not found.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-hidden">
        {activeTab === "stats" && (
          <StatsTab stats={(upload.basicStats as BasicStats | undefined) ?? null} />
        )}
        {activeTab === "conversations" && (
          <ConversationsTab uploadId={upload._id} />
        )}
      </div>
    </div>
  );
}
