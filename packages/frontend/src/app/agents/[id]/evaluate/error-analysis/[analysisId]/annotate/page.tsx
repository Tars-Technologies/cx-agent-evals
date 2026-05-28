"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { AnnotationSidePanel } from "@/components/annotation/AnnotationSidePanel";
import { ImportMoreModal } from "@/components/errorAnalysis/ImportMoreModal";
import type { Turn } from "@/components/annotation/AnnotationEditor";

const ORIGIN_LABEL: Record<string, string> = {
  simulation: "SIMULATION",
  upload: "UPLOAD",
  playground: "PLAYGROUND",
  custom: "CUSTOM",
};

function ErrorAnalysisHeader({
  agentId,
  analysisId,
  onImport,
}: {
  agentId: Id<"agents">;
  analysisId: Id<"errorAnalyses">;
  onImport(): void;
}) {
  const pathname = usePathname() ?? "";
  const analysis = useQuery(api.errorAnalysis.orchestration.get, { id: analysisId });
  const annotateHref = `/agents/${agentId}/evaluate/error-analysis/${analysisId}/annotate`;
  const failureModesHref = `/agents/${agentId}/evaluate/error-analysis/${analysisId}/failure-modes`;
  const tabs = [
    { label: "Annotate", href: annotateHref },
    { label: "Failure modes", href: failureModesHref },
  ];

  return (
    <div className="border-b border-border bg-bg-elevated/40 shrink-0">
      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-medium text-text">
          {analysis?.name ?? "…"}
        </div>
        {analysis && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-surface text-text-dim">
            {ORIGIN_LABEL[analysis.origin.kind] ?? analysis.origin.kind}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onImport}
            className="px-2.5 py-1 text-[11px] text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            Import more
          </button>
        </div>
      </div>
      <div className="px-4 flex gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-1.5 text-xs border-b-2 transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-text-dim hover:text-text"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type Member =
  NonNullable<
    ReturnType<typeof useQuery<typeof api.errorAnalysis.orchestration.membersByAnalysis>>
  >[number];

function memberKey(m: Member): string {
  return m.source.kind === "conversation"
    ? `c:${m.source.conversationId}`
    : `t:${m.source.transcriptId}`;
}

function memberLabel(m: Member): string {
  if (m.source.kind === "conversation") {
    return m.conversation?.title ?? `Conv ${String(m.source.conversationId).slice(-6)}`;
  }
  return (
    m.transcript?.visitorName ||
    m.transcript?.conversationId ||
    `Transcript ${String(m.source.transcriptId).slice(-6)}`
  );
}

function MemberList({
  members,
  selectedKey,
  onSelect,
}: {
  members: Member[];
  selectedKey: string | null;
  onSelect(m: Member): void;
}) {
  if (members.length === 0) {
    return (
      <div className="p-4 text-xs text-text-dim italic">No members yet.</div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {members.map((m) => {
        const k = memberKey(m);
        const active = k === selectedKey;
        return (
          <li key={k}>
            <button
              onClick={() => onSelect(m)}
              className={`w-full text-left px-3 py-2 transition-colors ${
                active ? "bg-accent/10 text-accent" : "text-text hover:bg-bg-elevated"
              }`}
            >
              <div className="text-xs truncate">{memberLabel(m)}</div>
              <div className="text-[10px] text-text-dim mt-0.5 flex items-center gap-1.5">
                <span className="uppercase tracking-wider">
                  {m.source.kind === "conversation" ? "Conv" : "Transcript"}
                </span>
                {m.addedVia === "annotation" && (
                  <span className="px-1 rounded bg-accent/15 text-accent">
                    annotated
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ConversationCenter({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  const messages = useQuery(api.crud.conversations.listMessages, {
    conversationId,
  });
  if (messages === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-dim">
        Loading transcript…
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {messages.length === 0 ? (
        <div className="text-xs text-text-dim italic">No messages.</div>
      ) : (
        messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg._id}
              className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}
            >
              <div
                className={`max-w-[70%] px-2.5 py-1.5 text-xs whitespace-pre-wrap ${
                  isUser
                    ? "bg-accent-dim text-white rounded-lg rounded-br-sm"
                    : "bg-bg-surface text-text border border-border rounded-lg rounded-bl-sm"
                }`}
              >
                <div
                  className={`text-[9px] mb-0.5 ${
                    isUser ? "text-white/50" : "text-text-dim"
                  }`}
                >
                  {isUser ? "User" : msg.role === "assistant" ? "Agent" : msg.role}
                </div>
                {msg.content}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function TranscriptCenter({
  transcriptId,
}: {
  transcriptId: Id<"livechatConversations">;
}) {
  const t = useQuery(api.livechat.orchestration.getConversation, {
    id: transcriptId,
  });
  if (t === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-dim">
        Loading transcript…
      </div>
    );
  }
  if (t === null) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-dim">
        Transcript not found.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {t.messages.map((m) => {
        const isUser = m.role === "user";
        if (m.role === "workflow_input") {
          return (
            <div key={m.id} className="text-center my-1">
              <span className="text-text-dim text-[10px] bg-bg-surface px-2 py-0.5 rounded-full">
                {m.text}
              </span>
            </div>
          );
        }
        return (
          <div
            key={m.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}
          >
            <div
              className={`max-w-[70%] px-2.5 py-1.5 text-xs whitespace-pre-wrap ${
                isUser
                  ? "bg-accent-dim text-white rounded-lg rounded-br-sm"
                  : "bg-bg-surface text-text border border-border rounded-lg rounded-bl-sm"
              }`}
            >
              <div
                className={`text-[9px] mb-0.5 ${
                  isUser ? "text-white/50" : "text-text-dim"
                }`}
              >
                {isUser ? "User" : "Agent"} · #{m.id}
              </div>
              {m.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Build a Turn[] for the annotation side panel. Falls back to empty when data is loading.
function useTurnsForSelected(selected: Member | null): Turn[] {
  const messages = useQuery(
    api.crud.conversations.listMessages,
    selected?.source.kind === "conversation"
      ? { conversationId: selected.source.conversationId }
      : "skip",
  );
  const transcript = useQuery(
    api.livechat.orchestration.getConversation,
    selected?.source.kind === "transcript"
      ? { id: selected.source.transcriptId }
      : "skip",
  );

  return useMemo<Turn[]>(() => {
    if (!selected) return [];
    if (selected.source.kind === "conversation") {
      if (!messages) return [];
      return messages
        .filter((m) =>
          ["user", "assistant", "tool_call", "tool_result", "system"].includes(
            m.role,
          ),
        )
        .map((m) => ({
          role: m.role as Turn["role"],
          content: m.content,
        }));
    }
    if (!transcript) return [];
    return transcript.messages
      .filter((m) => m.role !== "workflow_input")
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as Turn["role"],
        content: m.text,
      }));
  }, [selected, messages, transcript]);
}

export default function AnnotatePage() {
  const { id, analysisId } = useParams<{ id: string; analysisId: string }>();
  const agentId = id as Id<"agents">;
  const errorAnalysisId = analysisId as Id<"errorAnalyses">;
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const analysis = useQuery(api.errorAnalysis.orchestration.get, {
    id: errorAnalysisId,
  });
  const members = useQuery(
    api.errorAnalysis.orchestration.membersByAnalysis,
    { errorAnalysisId },
  );

  const [importOpen, setImportOpen] = useState(false);

  const list = members ?? [];
  const convParam = searchParams.get("conv");
  const selected =
    list.find((m) => memberKey(m) === convParam) ??
    (list.length > 0 ? list[0] : null);
  const selectedKey = selected ? memberKey(selected) : null;

  function handleSelect(m: Member) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("conv", memberKey(m));
    router.replace(`${pathname}?${sp.toString()}`);
  }

  const turns = useTurnsForSelected(selected);

  const conversationRef = selected
    ? selected.source.kind === "conversation"
      ? ({
          kind: "conversation",
          conversationId: selected.source.conversationId,
        } as const)
      : ({
          kind: "transcript",
          transcriptId: selected.source.transcriptId,
        } as const)
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ErrorAnalysisHeader
        agentId={agentId}
        analysisId={errorAnalysisId}
        onImport={() => setImportOpen(true)}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: members */}
        <div className="w-1/4 min-w-[200px] border-r border-border overflow-y-auto">
          {members === undefined ? (
            <div className="p-4 text-xs text-text-dim">Loading…</div>
          ) : (
            <MemberList
              members={list}
              selectedKey={selectedKey}
              onSelect={handleSelect}
            />
          )}
        </div>

        {/* Center: transcript */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-xs text-text-dim">
              {list.length === 0
                ? "No members. Click 'Import more' to add."
                : "Select a member from the list."}
            </div>
          ) : selected.source.kind === "conversation" ? (
            <ConversationCenter conversationId={selected.source.conversationId} />
          ) : (
            <TranscriptCenter transcriptId={selected.source.transcriptId} />
          )}
        </div>

        {/* Right: annotation side panel */}
        <div className="w-1/4 min-w-[280px] border-l border-border overflow-hidden">
          {conversationRef ? (
            <div className="h-full">
              {/* Re-use AnnotationSidePanel as inline column rather than fixed overlay
                  by wrapping in a styled container that overrides positioning. */}
              <InlineAnnotationPanel
                agentId={agentId}
                conversationRef={conversationRef}
                errorAnalysisId={errorAnalysisId}
                turns={turns}
              />
            </div>
          ) : (
            <div className="p-4 text-xs text-text-dim">
              Select a member to annotate.
            </div>
          )}
        </div>
      </div>

      <ImportMoreModal
        errorAnalysisId={errorAnalysisId}
        origin={analysis?.origin ?? { kind: "custom" }}
        agentId={agentId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setImportOpen(false)}
      />
    </div>
  );
}

// AnnotationSidePanel is `fixed` and intended as an overlay. Here we render it as
// an inline column. We reproduce the inner contents minus the fixed positioning.
function InlineAnnotationPanel({
  agentId,
  conversationRef,
  errorAnalysisId,
  turns,
}: {
  agentId: Id<"agents">;
  conversationRef:
    | { kind: "conversation"; conversationId: Id<"conversations"> }
    | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };
  errorAnalysisId: Id<"errorAnalyses">;
  turns: Turn[];
}) {
  // Use AnnotationSidePanel directly; its `fixed right-0` styling will overlay
  // the right edge, which is acceptable since our third column is also pinned right.
  return (
    <AnnotationSidePanel
      agentId={agentId}
      conversationRef={conversationRef}
      originHint={{ kind: "analysis", errorAnalysisId }}
      conversation={{ turns }}
      open={true}
      onClose={() => {
        /* always open in this layout */
      }}
    />
  );
}
