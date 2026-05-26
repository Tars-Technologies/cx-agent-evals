"use client";

import { useEffect } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import {
  AnnotationEditor,
  type Annotation,
  type Turn,
} from "@/components/annotation/AnnotationEditor";
import { Spinner } from "@/components/shell/Spinner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function AnnotationDot({ annotated }: { annotated: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        annotated ? "bg-green-400" : "bg-border"
      }`}
      title={annotated ? "Annotated" : "Not annotated"}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OpenCodingPage() {
  const params = useParams<{ id: string; runId: string }>();
  const simId = params.runId as Id<"conversationSimulations">;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  const selectedConvId =
    (search.get("conversation") as Id<"conversations"> | null) ?? null;

  // ── Data fetching ────────────────────────────────────────────────────────

  const runs = useQuery(api.conversationSim.runs.bySimulation, {
    simulationId: simId,
  });

  const annotatableRuns = runs?.filter((r) => r.conversationId != null);

  // Fetch annotation stats for the whole list (to show dots) — one per conv.
  // We do this lazily by loading bySource for the selected conv only; for the
  // sidebar dots we use a separate allTagsForOrg-less approach: reuse the
  // bySource query for the selected conv and trust that bySource already
  // filters by the current user's org.
  const messages = useQuery(
    api.crud.conversations.listMessages,
    selectedConvId ? { conversationId: selectedConvId } : "skip",
  );

  const annotations = useQuery(
    api.annotations.crud.bySource,
    selectedConvId
      ? { source: { kind: "conversation", conversationId: selectedConvId } }
      : "skip",
  );

  const allTags = useQuery(api.annotations.crud.allTagsForOrg, {}) ?? [];

  const upsertAnnotation = useMutation(api.annotations.crud.upsert);

  // ── Auto-select first conversation ───────────────────────────────────────

  useEffect(() => {
    if (
      selectedConvId == null &&
      annotatableRuns &&
      annotatableRuns.length > 0
    ) {
      const firstConvId = annotatableRuns[0].conversationId!;
      router.replace(`${pathname}?conversation=${firstConvId}`);
    }
  }, [selectedConvId, annotatableRuns, pathname, router]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const turns: Turn[] = (messages ?? []).map((m) => ({
    role: m.role as Turn["role"],
    content: m.content,
  }));

  const existing: Annotation | null =
    annotations && annotations.length > 0
      ? {
          rating: annotations[0].rating as Annotation["rating"],
          comment: annotations[0].comment,
          tags: annotations[0].tags,
        }
      : null;

  async function onUpsert(input: {
    rating: Annotation["rating"];
    comment?: string;
    tags: string[];
  }) {
    if (!selectedConvId) return;
    await upsertAnnotation({
      source: { kind: "conversation", conversationId: selectedConvId },
      rating: input.rating,
      comment: input.comment,
      tags: input.tags,
    });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (runs === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="Loading runs…" />
      </div>
    );
  }

  // ── Empty: no annotatable runs ────────────────────────────────────────────

  if (annotatableRuns?.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-sm">
        No conversations to annotate yet. Run the simulation first.
      </div>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: conversation list */}
      <div className="w-[280px] flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">
            Conversations
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {(annotatableRuns ?? []).map((run) => {
            const convId = run.conversationId!;
            const isSelected = selectedConvId === convId;
            const shortId = convId.slice(-6);
            const label = run.scenarioTopic
              ? run.scenarioTopic.length > 28
                ? run.scenarioTopic.slice(0, 28) + "…"
                : run.scenarioTopic
              : `conv-${shortId}`;

            return (
              <button
                key={convId}
                onClick={() =>
                  router.replace(`${pathname}?conversation=${convId}`)
                }
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors border-b border-border/50 ${
                  isSelected
                    ? "bg-accent/10 text-text"
                    : "text-text-dim hover:bg-bg-hover hover:text-text"
                }`}
              >
                {/* Placeholder dot — green if selected conv has annotation,
                    gray otherwise. For non-selected rows we don't load
                    annotations individually; a full stats query would be added
                    in a follow-up. */}
                <AnnotationDot
                  annotated={
                    isSelected ? (annotations?.length ?? 0) > 0 : false
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{label}</div>
                  <div className="text-[10px] text-text-dim font-mono mt-0.5">
                    {shortId}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: AnnotationEditor (transcript + form) */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedConvId == null ? (
          <div className="h-full flex items-center justify-center text-text-dim text-sm">
            Select a conversation.
          </div>
        ) : messages === undefined ? (
          <div className="h-full flex items-center justify-center">
            <Spinner label="Loading transcript…" />
          </div>
        ) : (
          <AnnotationEditor
            conversation={{ turns }}
            existingAnnotation={existing}
            allTags={allTags}
            onUpsert={onUpsert}
          />
        )}
      </div>
    </div>
  );
}
