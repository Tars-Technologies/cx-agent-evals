"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { CalibrationFlow } from "@/components/calibration/CalibrationFlow";

// ─── Types ───────────────────────────────────────────────────────────────────

type Evaluator = NonNullable<ReturnType<typeof useQuery<typeof api.evaluator.crud.get>>>;
type Label = NonNullable<ReturnType<typeof useQuery<typeof api.evaluator.labels.byEvaluator>>>[number];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-500/15 text-yellow-400",
  calibrating: "bg-accent/15 text-accent",
  validated: "bg-accent/15 text-accent",
  ready: "bg-green-500/15 text-green-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
        STATUS_COLORS[status] ?? "bg-border text-text-dim"
      }`}
    >
      {status}
    </span>
  );
}

// ─── Configure tab ────────────────────────────────────────────────────────────

function ConfigureTab({ evaluator }: { evaluator: Evaluator }) {
  const update = useMutation(api.evaluator.crud.update);

  const [name, setName] = useState(evaluator.name);
  const [description, setDescription] = useState(evaluator.description);
  const [tagsStr, setTagsStr] = useState((evaluator.tags ?? []).join(", "));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LLM judge dimension fields (first dimension only)
  const dim0 = evaluator.llmJudgeConfig?.dimensions[0];
  const [dimName, setDimName] = useState(dim0?.name ?? "");
  const [dimRubric, setDimRubric] = useState(dim0?.rubric ?? "");
  const [model, setModel] = useState(evaluator.llmJudgeConfig?.model ?? "");
  const inputContextAll = ["transcript", "tool_calls", "kb_documents"] as const;
  const [inputContext, setInputContext] = useState<string[]>(
    evaluator.llmJudgeConfig?.inputContext ?? [],
  );

  // Code judge config
  const [codeParams, setCodeParams] = useState(
    evaluator.codeJudgeConfig?.params != null
      ? JSON.stringify(evaluator.codeJudgeConfig.params, null, 2)
      : "",
  );
  const [codeParamsError, setCodeParamsError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setCodeParamsError(null);
    try {
      const tags = tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const patch: Parameters<typeof update>[0] = {
        id: evaluator._id,
        name,
        description,
        tags,
      };

      if (evaluator.type === "llm_judge" && evaluator.llmJudgeConfig) {
        const updatedDims = evaluator.llmJudgeConfig.dimensions.map((d, i) => {
          if (i === 0) {
            return { ...d, name: dimName, rubric: dimRubric };
          }
          return d;
        });
        patch.llmJudgeConfig = {
          ...evaluator.llmJudgeConfig,
          dimensions: updatedDims,
          model,
          inputContext: inputContext as ("transcript" | "tool_calls" | "kb_documents")[],
        };
      }

      if (evaluator.type === "code" && evaluator.codeJudgeConfig) {
        let params: unknown;
        try {
          params = JSON.parse(codeParams);
        } catch {
          setCodeParamsError("Invalid JSON");
          setSaving(false);
          return;
        }
        patch.codeJudgeConfig = {
          ...evaluator.codeJudgeConfig,
          params,
        };
      }

      await update(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleContext(val: string) {
    setInputContext((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* Status (read-only) */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-dim">Status:</span>
        <StatusBadge status={evaluator.status} />
        <span className="text-[10px] text-text-dim ml-1">(updated by Validate tab)</span>
      </div>

      {/* Core fields */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-text-dim mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-dim mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent resize-none"
          />
        </div>
        <div>
          <label className="block text-xs text-text-dim mb-1">Tags (comma-separated)</label>
          <input
            type="text"
            value={tagsStr}
            onChange={(e) => setTagsStr(e.target.value)}
            placeholder="e.g. accuracy, tone"
            className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Code judge config */}
      {evaluator.type === "code" && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-text">Code judge config</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-dim">Check type:</span>
            <span className="text-xs text-text">{evaluator.codeJudgeConfig?.checkType}</span>
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Params (JSON)</label>
            <textarea
              value={codeParams}
              onChange={(e) => setCodeParams(e.target.value)}
              rows={6}
              className={`w-full bg-bg-surface border rounded px-3 py-1.5 text-xs text-text font-mono focus:outline-none resize-none ${
                codeParamsError ? "border-red-500" : "border-border focus:border-accent"
              }`}
            />
            {codeParamsError && (
              <p className="text-[10px] text-red-400 mt-1">{codeParamsError}</p>
            )}
          </div>
        </div>
      )}

      {/* LLM judge config */}
      {evaluator.type === "llm_judge" && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <p className="text-xs font-medium text-text">LLM judge config (dimension 1)</p>
          <div>
            <label className="block text-xs text-text-dim mb-1">Dimension name</label>
            <input
              type="text"
              value={dimName}
              onChange={(e) => setDimName(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Rubric</label>
            <textarea
              value={dimRubric}
              onChange={(e) => setDimRubric(e.target.value)}
              rows={5}
              className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4o"
              className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-2">Input context</label>
            <div className="flex flex-wrap gap-3">
              {inputContextAll.map((ctx) => (
                <label key={ctx} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputContext.includes(ctx)}
                    onChange={() => toggleContext(ctx)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-text">{ctx}</span>
                </label>
              ))}
            </div>
          </div>
          {(evaluator.llmJudgeConfig?.dimensions.length ?? 0) > 1 && (
            <p className="text-[10px] text-text-dim">
              This evaluator has {evaluator.llmJudgeConfig!.dimensions.length} dimensions. Only
              dimension 1 is editable here.
            </p>
          )}
        </div>
      )}

      {/* Save */}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
      </button>
    </div>
  );
}

// ─── Add-labels stub modal ────────────────────────────────────────────────────

function ComingSoonModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-elevated border border-border rounded-xl p-6 max-w-sm w-full shadow-xl">
        <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
        <p className="text-xs text-text-dim mb-4">Coming soon (Task 12).</p>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Labels tab ───────────────────────────────────────────────────────────────

function LabelsTab({
  evaluatorId,
  agentId,
}: {
  evaluatorId: Id<"evaluators">;
  agentId: Id<"agents">;
}) {
  const labels = useQuery(api.evaluator.labels.byEvaluator, { evaluatorId });
  const counts = useQuery(api.evaluator.labels.counts, { evaluatorId });
  const removeLabel = useMutation(api.evaluator.labels.remove);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [comingSoonModal, setComingSoonModal] = useState<string | null>(null);
  const [showCalibrationFlow, setShowCalibrationFlow] = useState(false);

  function shortId(id: string) {
    return id.slice(-6);
  }

  async function handleDelete(labelId: Id<"evaluatorLabels">) {
    await removeLabel({ id: labelId });
  }

  return (
    <div className="space-y-4">
      {/* Counts header */}
      {counts !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-dim">
          <span className="font-medium text-text">{counts.total} labels</span>
          <span>·</span>
          <span className="text-green-400">{counts.pass} pass</span>
          <span>·</span>
          <span className="text-red-400">{counts.fail} fail</span>
          <span>·</span>
          <span>train {counts.train}</span>
          <span>/</span>
          <span>dev {counts.dev}</span>
          <span>/</span>
          <span>test {counts.test}</span>
        </div>
      )}

      {/* Add labels button */}
      <div className="relative inline-block">
        <button
          onClick={() => setAddMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-surface transition-colors text-text"
        >
          + Add labels
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {addMenuOpen && (
          <div className="absolute left-0 top-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-xl z-20 py-1 min-w-[220px]">
            {[
              "Calibrate fresh sample",
              "Import from open-coding tags",
              "Manually paste conversations",
            ].map((item) => (
              <button
                key={item}
                className="w-full text-left px-3 py-2 text-xs text-text hover:bg-bg-surface transition-colors"
                onClick={() => {
                  setAddMenuOpen(false);
                  if (item === "Calibrate fresh sample") {
                    setShowCalibrationFlow(true);
                  } else {
                    setComingSoonModal(item);
                  }
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Labels table */}
      {labels === undefined ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded bg-bg-elevated border border-border animate-pulse" />
          ))}
        </div>
      ) : labels.length === 0 ? (
        <div className="py-12 text-center text-text-dim text-xs">
          No labels yet. Use &apos;Add labels&apos; to add some.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-text-dim">
                <th className="text-left py-2 pr-4 font-medium">Source</th>
                <th className="text-left py-2 pr-4 font-medium">Label</th>
                <th className="text-left py-2 pr-4 font-medium">Split</th>
                <th className="text-left py-2 pr-4 font-medium">Origin</th>
                <th className="text-right py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label: Label) => (
                <tr
                  key={label._id}
                  className="border-b border-border/50 hover:bg-bg-surface transition-colors"
                >
                  <td className="py-2 pr-4 text-text-dim">
                    {label.source.kind === "conversation" ? (
                      <span>
                        conv{" "}
                        <span className="font-mono text-text">
                          {shortId(label.source.conversationId)}
                        </span>
                      </span>
                    ) : (
                      <span>
                        transcript{" "}
                        <span className="font-mono text-text">
                          {shortId(label.source.transcriptId)}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        label.humanLabel === "pass"
                          ? "bg-green-500/15 text-green-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {label.humanLabel}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-text-dim">
                    {label.splitAssignment ?? (
                      <span className="text-text-dim italic">unassigned</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-text-dim">{label.origin.kind}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDelete(label._id)}
                      className="text-text-dim hover:text-red-400 transition-colors px-1"
                      title="Delete label"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comingSoonModal && (
        <ComingSoonModal
          title={comingSoonModal}
          onClose={() => setComingSoonModal(null)}
        />
      )}

      {showCalibrationFlow && (
        <CalibrationFlow
          evaluatorId={evaluatorId}
          agentId={agentId}
          onClose={() => setShowCalibrationFlow(false)}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EvaluatorDetailPage() {
  const params = useParams<{ id: string; evalId: string }>();
  const evalId = params.evalId as Id<"evaluators">;
  const agentId = params.id as Id<"agents">;
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  const evaluator = useQuery(api.evaluator.crud.get, { id: evalId });

  if (evaluator === undefined) {
    return (
      <div className="space-y-3 max-w-xl">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded bg-bg-elevated border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (tab === "labels") {
    return <LabelsTab evaluatorId={evalId} agentId={agentId} />;
  }

  return <ConfigureTab evaluator={evaluator} />;
}
