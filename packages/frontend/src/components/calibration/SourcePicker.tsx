"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export type SourceKind = "real" | "simulation" | "transcript";

export type SourceSelection = {
  kinds: Set<SourceKind>;
  simulationIds?: Id<"conversationSimulations">[];
  transcriptUploadIds?: Id<"livechatUploads">[];
};

export interface SourcePickerProps {
  agentId: Id<"agents">;
  value: SourceSelection;
  onChange(s: SourceSelection): void;
}

export function SourcePicker({
  agentId,
  value,
  onChange,
}: SourcePickerProps): JSX.Element {
  const realCount = useQuery(api.crud.conversations.countByAgentAndSource, {
    agentId,
    source: "playground",
  });
  const simulationCount = useQuery(
    api.crud.conversations.countByAgentAndSource,
    {
      agentId,
      source: "simulation",
    },
  );
  const uploads = useQuery(api.livechat.orchestration.list, {});

  function toggleKind(kind: SourceKind, checked: boolean) {
    const next = new Set(value.kinds);
    if (checked) {
      next.add(kind);
    } else {
      next.delete(kind);
    }

    const update: SourceSelection = { ...value, kinds: next };

    // When unchecking transcript, clear selected upload IDs
    if (kind === "transcript" && !checked) {
      update.transcriptUploadIds = [];
    }

    onChange(update);
  }

  function toggleUpload(
    uploadId: Id<"livechatUploads">,
    checked: boolean,
  ) {
    const current = value.transcriptUploadIds ?? [];
    const next = checked
      ? [...current, uploadId]
      : current.filter((id) => id !== uploadId);

    onChange({ ...value, transcriptUploadIds: next });
  }

  const transcriptChecked = value.kinds.has("transcript");
  const uploadCount = uploads?.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Real conversations */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent w-4 h-4"
            checked={value.kinds.has("real")}
            onChange={(e) => toggleKind("real", e.target.checked)}
          />
          <span className="text-sm">
            Real conversations{" "}
            <span className="text-text-muted">
              ({realCount ?? "…"} available)
            </span>
          </span>
        </label>
        {realCount === 0 && (
          <p className="ml-7 text-xs text-text-muted">
            No conversations of this kind yet
          </p>
        )}
      </div>

      {/* Simulation conversations */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent w-4 h-4"
            checked={value.kinds.has("simulation")}
            onChange={(e) => toggleKind("simulation", e.target.checked)}
          />
          <span className="text-sm">
            Simulation conversations{" "}
            <span className="text-text-muted">
              ({simulationCount ?? "…"} available)
            </span>
          </span>
        </label>
        {simulationCount === 0 && (
          <p className="ml-7 text-xs text-text-muted">
            No conversations of this kind yet
          </p>
        )}
      </div>

      {/* Uploaded transcripts */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent w-4 h-4"
            checked={transcriptChecked}
            onChange={(e) => toggleKind("transcript", e.target.checked)}
          />
          <span className="text-sm">
            Uploaded transcripts{" "}
            <span className="text-text-muted">
              ({uploadCount} upload{uploadCount !== 1 ? "s" : ""})
            </span>
          </span>
        </label>

        {uploadCount === 0 && (
          <p className="ml-7 text-xs text-text-muted">
            No conversations of this kind yet
          </p>
        )}

        {/* Expanded per-upload checklist (visible when "transcript" is checked) */}
        {transcriptChecked && uploadCount > 0 && (
          <ul className="ml-7 mt-1 flex flex-col gap-1 rounded-md border border-border bg-bg-elevated p-2">
            {(uploads ?? []).map((upload) => (
              <li key={upload._id}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent w-3.5 h-3.5"
                    checked={(value.transcriptUploadIds ?? []).includes(
                      upload._id,
                    )}
                    onChange={(e) => toggleUpload(upload._id, e.target.checked)}
                  />
                  <span className="text-xs text-text-muted truncate">
                    {upload.filename}
                    {upload.conversationCount != null && (
                      <span className="ml-1 text-accent">
                        ({upload.conversationCount})
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
