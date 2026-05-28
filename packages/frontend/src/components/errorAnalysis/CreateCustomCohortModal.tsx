"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

type SourceKind = "playground" | "simulation" | "upload";
type Size = 10 | 20 | 50 | 100 | 200;

type SourcePool =
  | { kind: "playground" }
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> };

interface CreateCustomCohortModalProps {
  agentId: Id<"agents">;
  open: boolean;
  onClose(): void;
  onCreated(analysisId: Id<"errorAnalyses">): void;
}

const SIZES: Size[] = [10, 20, 50, 100, 200];

function defaultName(kind: SourceKind, size: Size): string {
  switch (kind) {
    case "playground":
      return `Last ${size} real conversations`;
    case "simulation":
      return `Last ${size} from simulation run`;
    case "upload":
      return `Last ${size} from transcript upload`;
  }
}

export function CreateCustomCohortModal({
  agentId,
  open,
  onClose,
  onCreated,
}: CreateCustomCohortModalProps) {
  const createCustom = useMutation(api.errorAnalysis.orchestration.createCustom);

  const simulations = useQuery(
    api.conversationSim.orchestration.byAgent,
    open ? { agentId } : "skip",
  );
  const uploads = useQuery(
    api.livechat.orchestration.list,
    open ? {} : "skip",
  );

  const [sourceKind, setSourceKind] = useState<SourceKind>("playground");
  const [simulationId, setSimulationId] =
    useState<Id<"conversationSimulations"> | "">("");
  const [uploadId, setUploadId] = useState<Id<"livechatUploads"> | "">("");
  const [size, setSize] = useState<Size>(100);
  const [name, setName] = useState<string>(defaultName("playground", 100));
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (!open) return;
    setSourceKind("playground");
    setSimulationId("");
    setUploadId("");
    setSize(100);
    setName(defaultName("playground", 100));
    setNameTouched(false);
    setSubmitting(false);
    setError(null);
  }, [open]);

  // Pre-fill name as source/size change (unless user typed their own)
  useEffect(() => {
    if (nameTouched) return;
    setName(defaultName(sourceKind, size));
  }, [sourceKind, size, nameTouched]);

  const sourcePool: SourcePool | null = useMemo(() => {
    if (sourceKind === "playground") return { kind: "playground" };
    if (sourceKind === "simulation") {
      if (!simulationId) return null;
      return { kind: "simulation", simulationId: simulationId as Id<"conversationSimulations"> };
    }
    if (!uploadId) return null;
    return { kind: "upload", uploadId: uploadId as Id<"livechatUploads"> };
  }, [sourceKind, simulationId, uploadId]);

  const canSubmit = !!sourcePool && name.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!sourcePool || !name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await createCustom({
        agentId,
        name: name.trim(),
        sourcePool,
        size,
      });
      onCreated(id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create cohort");
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
          <h2 className="text-lg font-medium text-text">Create custom cohort</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Source kind */}
        <div className="space-y-2">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Source
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name="source-kind"
                checked={sourceKind === "playground"}
                onChange={() => setSourceKind("playground")}
              />
              Real conversations (playground)
            </label>

            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="radio"
                name="source-kind"
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
                  >
                    <option value="">Select a simulation…</option>
                    {(simulations ?? []).map((sim) => (
                      <option key={sim._id} value={sim._id}>
                        {new Date(sim.startedAt).toLocaleString()} ·{" "}
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
                name="source-kind"
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

        {/* Size */}
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

        {/* Name */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:border-accent outline-none"
          />
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
            {submitting ? "Creating…" : "Create cohort"}
          </button>
        </div>
      </div>
    </div>
  );
}
