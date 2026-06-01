"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import {
  AnnotationEditor,
  type Turn,
  type Annotation,
} from "./AnnotationEditor";

export type PencilOriginHint =
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> }
  | { kind: "playground" }
  | { kind: "analysis"; errorAnalysisId: Id<"errorAnalyses"> };

export type ConversationRef =
  | { kind: "conversation"; conversationId: Id<"conversations"> }
  | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

export interface AnnotationSidePanelProps {
  agentId: Id<"agents">;
  conversationRef: ConversationRef;
  originHint: PencilOriginHint;
  conversation: { turns: Turn[] };
  open: boolean;
  onClose(): void;
}

export function AnnotationSidePanel({
  agentId,
  conversationRef,
  originHint,
  conversation,
  open,
  onClose,
}: AnnotationSidePanelProps) {
  const existing = useQuery(api.annotations.crud.bySource, {
    source: conversationRef,
  });
  const allTags = useQuery(api.annotations.crud.allTagsForOrg, {}) ?? [];
  const upsert = useMutation(api.annotations.crud.upsertWithAutoContainer);

  if (!open) return null;

  // bySource is already org-scoped; each user has at most one annotation
  // per conversation, so take the first row as "mine".
  const mine: Annotation | null =
    existing && existing.length > 0
      ? {
          rating: existing[0].rating,
          comment: existing[0].comment,
          tags: existing[0].tags,
        }
      : null;

  return (
    <aside className="fixed right-0 top-0 h-screen w-[360px] bg-zinc-900 border-l border-zinc-800 z-[60] flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Annotate</h2>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100 text-lg leading-none"
          aria-label="Close annotation panel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <AnnotationEditor
          conversation={conversation}
          existingAnnotation={mine}
          allTags={allTags}
          onUpsert={async ({ rating, comment, tags }) => {
            await upsert({
              agentId,
              source: conversationRef,
              hint: originHint,
              rating,
              comment,
              tags,
            });
          }}
        />
      </div>
    </aside>
  );
}
