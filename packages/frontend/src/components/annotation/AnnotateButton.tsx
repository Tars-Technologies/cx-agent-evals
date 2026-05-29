"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { AnnotationEditor, type Annotation } from "./AnnotationEditor";

export type PencilOriginHint =
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> }
  | { kind: "playground" }
  | { kind: "analysis"; errorAnalysisId: Id<"errorAnalyses"> };

export type ConversationRef =
  | { kind: "conversation"; conversationId: Id<"conversations"> }
  | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

export interface AnnotateButtonProps {
  agentId: Id<"agents">;
  conversationRef: ConversationRef;
  originHint: PencilOriginHint;
}

export function AnnotateButton({
  agentId,
  conversationRef,
  originHint,
}: AnnotateButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const existing = useQuery(api.annotations.crud.bySource, {
    source: conversationRef,
  });
  const allTags = useQuery(api.annotations.crud.allTagsForOrg, {}) ?? [];
  const upsert = useMutation(api.annotations.crud.upsertWithAutoContainer);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const mine: Annotation | null =
    existing && existing.length > 0
      ? {
          rating: existing[0].rating,
          comment: existing[0].comment,
          tags: existing[0].tags,
        }
      : null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Annotate"
        aria-label="Annotate"
        aria-expanded={open}
        className={`px-2.5 py-1 text-[10px] border rounded transition-colors ${
          open || mine
            ? "text-accent border-accent/60 bg-accent/10"
            : "text-accent border-accent/30 hover:bg-accent/10"
        }`}
      >
        ✏ Annotate{mine ? ` · ${mine.rating}` : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[340px] bg-bg-elevated border border-border rounded-lg shadow-2xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <h3 className="text-xs font-semibold text-text uppercase tracking-wide">
              Annotate
            </h3>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close annotation"
              className="text-text-dim hover:text-text text-sm leading-none"
            >
              ✕
            </button>
          </div>
          <AnnotationEditor
            conversation={{ turns: [] }}
            showConversation={false}
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
      )}
    </div>
  );
}
