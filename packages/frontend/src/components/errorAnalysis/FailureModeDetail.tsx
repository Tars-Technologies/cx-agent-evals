"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { SourceTranscript, type SourceRef } from "./SourceTranscript";

// A member row from errorAnalysis.orchestration.membersByAnalysis.
export type AnalysisMember = {
  source: SourceRef;
  annotationRating: string | null;
  conversation: { title?: string } | null;
  transcript: { visitorName?: string; conversationId?: string } | null;
};

export type FailureModeWithCounts = {
  _id: Id<"failureModes">;
  name: string;
  description: string;
  agentId: Id<"agents">;
  errorAnalysisId: Id<"errorAnalyses">;
  memberCount: number;
  judgeCount: number;
};

// A membership row from failureModes.memberships.byFailureMode.
type Membership = { source: SourceRef };

const RATING_DOT: Record<string, string> = {
  pass: "bg-accent",
  great: "bg-accent",
  good_enough: "bg-accent",
  fail: "bg-red-400",
  bad: "bg-red-400",
};

export function sourceKey(s: SourceRef): string {
  return s.kind === "conversation"
    ? `c:${s.conversationId}`
    : `t:${s.transcriptId}`;
}

function memberLabel(m: AnalysisMember): string {
  if (m.source.kind === "conversation") {
    return (
      m.conversation?.title ??
      `Conv ${String(m.source.conversationId).slice(-6)}`
    );
  }
  return (
    m.transcript?.visitorName ||
    m.transcript?.conversationId ||
    `Transcript ${String(m.source.transcriptId).slice(-6)}`
  );
}

export function FailureModeDetail({
  mode,
  members,
  memberships,
  onSpawnJudge,
  onDeleted,
}: {
  mode: FailureModeWithCounts;
  members: AnalysisMember[];
  memberships: Membership[] | undefined;
  onSpawnJudge(): Promise<void>;
  onDeleted(): void;
}) {
  const update = useMutation(api.failureModes.crud.update);
  const removeMode = useMutation(api.failureModes.crud.remove);
  const addMember = useMutation(api.failureModes.memberships.add);
  const removeMember = useMutation(api.failureModes.memberships.remove);

  // Inline-editable name/description, reseeded when the selected mode changes.
  const [name, setName] = useState(mode.name);
  const [description, setDescription] = useState(mode.description);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const modeIdRef = useRef(mode._id);
  useEffect(() => {
    if (modeIdRef.current !== mode._id) {
      modeIdRef.current = mode._id;
      setName(mode.name);
      setDescription(mode.description);
      setSaveState("idle");
    }
  }, [mode._id, mode.name, mode.description]);

  const [addOpen, setAddOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberByKey = new Map(members.map((m) => [sourceKey(m.source), m]));
  const inModeKeys = new Set((memberships ?? []).map((ms) => sourceKey(ms.source)));
  const candidates = members.filter((m) => !inModeKeys.has(sourceKey(m.source)));

  async function saveText(next: { name?: string; description?: string }) {
    if (
      (next.name ?? mode.name) === mode.name &&
      (next.description ?? mode.description) === mode.description
    ) {
      return; // unchanged
    }
    setSaveState("saving");
    setError(null);
    try {
      await update({ id: mode._id, ...next });
      setSaveState("saved");
    } catch (e) {
      setSaveState("idle");
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function handleAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header: editable name + description */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2">
        <div className="flex items-start gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => saveText({ name: name.trim() || mode.name })}
            className="flex-1 bg-transparent text-sm font-semibold text-text outline-none focus:bg-bg-elevated rounded px-1 -mx-1"
            placeholder="Failure mode name"
          />
          <span className="text-[10px] text-text-dim mt-1 flex-shrink-0">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "✓ Saved"
                : ""}
          </span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => saveText({ description })}
          rows={2}
          className="w-full bg-transparent text-xs text-text-dim outline-none focus:bg-bg-elevated rounded px-1 -mx-1 resize-none whitespace-pre-wrap"
          placeholder="Describe the failure pattern…"
        />
      </div>

      {/* Conversations */}
      <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-text-dim uppercase tracking-wider">
            Conversations ({memberships?.length ?? 0})
          </span>
          <button
            onClick={() => setAddOpen((o) => !o)}
            className="px-2 py-1 text-[11px] text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            + Add
          </button>
        </div>

        {addOpen && (
          <div className="mb-2 border border-border rounded bg-bg-elevated max-h-48 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-text-dim italic">
                All analysis conversations are already in this mode.
              </div>
            ) : (
              candidates.map((m) => {
                const k = sourceKey(m.source);
                return (
                  <button
                    key={k}
                    onClick={() =>
                      handleAction(() =>
                        addMember({ failureModeId: mode._id, source: m.source }),
                      )
                    }
                    className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg-hover flex items-center gap-1.5"
                  >
                    {m.annotationRating && RATING_DOT[m.annotationRating] && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          RATING_DOT[m.annotationRating]
                        }`}
                      />
                    )}
                    <span className="truncate">{memberLabel(m)}</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {memberships === undefined ? (
          <div className="text-[11px] text-text-dim">Loading…</div>
        ) : memberships.length === 0 ? (
          <div className="text-[11px] text-text-dim italic">
            No conversations yet. Use “+ Add”.
          </div>
        ) : (
          <ul className="space-y-1">
            {memberships.map((ms) => {
              const k = sourceKey(ms.source);
              const m = memberByKey.get(k);
              const label = m
                ? memberLabel(m)
                : ms.source.kind === "conversation"
                  ? `Conv ${String(ms.source.conversationId).slice(-6)}`
                  : `Transcript ${String(ms.source.transcriptId).slice(-6)}`;
              const rating = m?.annotationRating ?? null;
              const expanded = expandedKey === k;
              return (
                <li key={k} className="border border-border rounded">
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      onClick={() => setExpandedKey(expanded ? null : k)}
                      className="text-text-dim hover:text-text text-[10px] w-3 flex-shrink-0"
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                    {rating && RATING_DOT[rating] && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${RATING_DOT[rating]}`}
                      />
                    )}
                    <span className="flex-1 truncate text-xs text-text">
                      {label}
                    </span>
                    <button
                      onClick={() =>
                        handleAction(() =>
                          removeMember({
                            failureModeId: mode._id,
                            source: ms.source,
                          }),
                        )
                      }
                      className="text-text-dim hover:text-red-400 text-sm leading-none flex-shrink-0"
                      aria-label="Remove from failure mode"
                      title="Remove from this failure mode"
                    >
                      ✕
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-2 pb-2 pt-1 border-t border-border max-h-80 overflow-y-auto">
                      <SourceTranscript source={ms.source} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-border flex-shrink-0 space-y-2">
        {error && <div className="text-[11px] text-red-400">{error}</div>}
        {mode.judgeCount > 0 && (
          <div className="text-[11px] text-text-dim">
            {mode.judgeCount} judge{mode.judgeCount === 1 ? "" : "s"} spawned
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() =>
              handleAction(async () => {
                const ok = window.confirm(
                  `Delete failure mode “${mode.name}”? This cannot be undone.`,
                );
                if (!ok) return;
                await removeMode({ id: mode._id });
                onDeleted();
              })
            }
            className="px-2.5 py-1.5 text-[11px] text-text-dim border border-border rounded hover:text-red-400 hover:border-red-400/40 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={async () => {
              if (spawning) return;
              setSpawning(true);
              setError(null);
              try {
                await onSpawnJudge();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to spawn judge");
              } finally {
                setSpawning(false);
              }
            }}
            disabled={spawning}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {spawning ? "Spawning…" : "Spawn judge"}
          </button>
        </div>
      </div>
    </div>
  );
}
