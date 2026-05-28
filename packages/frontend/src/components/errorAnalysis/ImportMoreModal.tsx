"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

type Size = 10 | 20 | 50 | 100 | 200;
type SourceKind = "playground" | "simulation" | "upload";

type SourcePool =
  | { kind: "playground" }
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> };

interface ImportMoreModalProps {
  errorAnalysisId: Id<"errorAnalyses">;
  origin: {
    kind: "simulation" | "upload" | "playground" | "custom";
    simulationId?: Id<"conversationSimulations">;
    uploadId?: Id<"livechatUploads">;
  };
  // If origin is "custom", we need an agentId to fetch sim/upload pickers.
  agentId?: Id<"agents">;
  open: boolean;
  onClose(): void;
  onImported(count: number): void;
}

const SIZES: Size[] = [10, 20, 50, 100, 200];

export function ImportMoreModal({
  errorAnalysisId,
  origin,
  agentId,
  open,
  onClose,
  onImported,
}: ImportMoreModalProps) {
  const importMore = useMutation(api.errorAnalysis.orchestration.importMore);
  const isCustom = origin.kind === "custom";

  const simulations = useQuery(
    api.conversationSim.orchestration.byAgent,
    open && isCustom && agentId ? { agentId } : "skip",
  );
  const uploads = useQuery(
    api.livechat.orchestration.list,
    open && isCustom ? {} : "skip",
  );

  const [size, setSize] = useState<Size>(50);
  const [sourceKind, setSourceKind] = useState<SourceKind>("playground");
  const [simulationId, setSimulationId] =
    useState<Id<"conversationSimulations"> | "">("");
  const [uploadId, setUploadId] = useState<Id<"livechatUploads"> | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSize(50);
    setSubmitting(false);
    setError(null);
    if (isCustom) {
      setSourceKind("playground");
      setSimulationId("");
      setUploadId("");
    }
  }, [open, isCustom]);

  const sourcePool: SourcePool | null = useMemo(() => {
    if (!isCustom) {
      if (origin.kind === "playground") return { kind: "playground" };
      if (origin.kind === "simulation" && origin.simulationId) {
        return { kind: "simulation", simulationId: origin.simulationId };
      }
      if (origin.kind === "upload" && origin.uploadId) {
        return { kind: "upload", uploadId: origin.uploadId };
      }
      return null;
    }
    // Custom — pick from form
    if (sourceKind === "playground") return { kind: "playground" };
    if (sourceKind === "simulation") {
      if (!simulationId) return null;
      return {
        kind: "simulation",
        simulationId: simulationId as Id<"conversationSimulations">,
      };
    }
    if (!uploadId) return null;
    return { kind: "upload", uploadId: uploadId as Id<"livechatUploads"> };
  }, [isCustom, origin, sourceKind, simulationId, uploadId]);

  const canSubmit = !!sourcePool && !submitting;

  async function handleSubmit() {
    if (!sourcePool || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const imported = await importMore({
        errorAnalysisId,
        sourcePool,
        size,
      });
      onImported(imported);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text">Import more conversations</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="border-t border-border" />

        {!isCustom && (
          <div className="text-xs text-text-dim">
            Sourced from the original{" "}
            <span className="text-text">{origin.kind}</span>.
          </div>
        )}

        {isCustom && (
          <div className="space-y-2">
            <label className="text-xs text-text-muted uppercase tracking-wide">
              Source
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="im-source-kind"
                  checked={sourceKind === "playground"}
                  onChange={() => setSourceKind("playground")}
                />
                Real conversations (playground)
              </label>

              <label className="flex items-start gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="im-source-kind"
                  checked={sourceKind === "simulation"}
                  onChange={() => setSourceKind("simulation")}
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <div>Simulation run</div>
                  {sourceKind === "simulation" && (
                    <select
                      value={simulationId}
                      onChange={(e) =>
                        setSimulationId(
                          e.target.value as Id<"conversationSimulations">,
                        )
                      }
                      className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
                      disabled={!agentId}
                    >
                      <option value="">
                        {agentId ? "Select a simulation…" : "agentId missing"}
                      </option>
                      {(simulations ?? []).map((sim) => (
                        <option key={sim._id} value={sim._id}>
                          {sim.startedAt ? new Date(sim.startedAt).toLocaleString() : "—"} ·{" "}
                          {sim.status} · {sim.completedRuns}/{sim.totalRuns}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="im-source-kind"
                  checked={sourceKind === "upload"}
                  onChange={() => setSourceKind("upload")}
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <div>Transcript upload</div>
                  {sourceKind === "upload" && (
                    <select
                      value={uploadId}
                      onChange={(e) =>
                        setUploadId(e.target.value as Id<"livechatUploads">)
                      }
                      className="w-full bg-bg border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
                    >
                      <option value="">Select an upload…</option>
                      {(uploads ?? []).map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.filename}
                          {u.conversationCount
                            ? ` · ${u.conversationCount} convs`
                            : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Size
          </label>
          <div className="flex gap-2">
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSize(n)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  size === n
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border text-text-dim hover:text-text"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-400 border border-red-900/50 bg-red-950/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="border-t border-border" />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-dim hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
