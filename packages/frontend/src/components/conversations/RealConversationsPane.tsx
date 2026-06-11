"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { RealConversationDetail } from "./RealConversationDetail";

function formatTimestamp(ts: number) {
  const date = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * day) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString();
}

export function RealConversationsPane({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const conversations = useQuery(api.crud.conversations.listForOrg);

  function select(id: string) {
    router.replace(`/conversations?id=${id}`, { scroll: false });
  }

  useEffect(() => {
    if (!selectedId && conversations && conversations.length > 0) {
      router.replace(`/conversations?id=${conversations[0]._id}`, { scroll: false });
    }
  }, [selectedId, conversations, router]);

  return (
    <div className="flex border border-border rounded-lg overflow-hidden flex-1 min-h-0">
      <aside className="w-80 shrink-0 border-r border-border flex flex-col bg-bg-elevated">
        <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-text-dim">
          {conversations === undefined
            ? "Loading…"
            : `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations === undefined && (
            <div className="p-4 text-xs text-text-dim">Loading…</div>
          )}
          {conversations && conversations.length === 0 && (
            <div className="p-4 text-xs text-text-dim">
              No live conversations yet. Start a chat from an agent's playground.
            </div>
          )}
          {conversations?.map((conv) => {
            const agentNames = conv.agents.map((a) => a.name).join(", ");
            const isActive = selectedId === conv._id;
            return (
              <div
                key={conv._id}
                role="button"
                tabIndex={0}
                onClick={() => select(conv._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(conv._id);
                  }
                }}
                className={`px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs text-text truncate">
                    {conv.title || agentNames || "Untitled"}
                  </span>
                  <span className="text-[9px] text-text-dim shrink-0">
                    {formatTimestamp(conv.lastMessageAt)}
                  </span>
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {conv.lastMessagePreview ?? "(no messages)"}
                </div>
                {conv.source && (
                  <div className="text-[9px] uppercase tracking-wider text-text-dim mt-0.5">
                    {conv.source}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 bg-bg overflow-hidden">
        {selectedId ? (
          <RealConversationDetail conversationId={selectedId as Id<"conversations">} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-text-dim">
            Select a conversation to view messages.
          </div>
        )}
      </section>
    </div>
  );
}
