"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

// ─── Constants ───────────────────────────────────────────────────────

const STEPS = ["Transcripts", "Configure", "Preferences", "Review"] as const;

const MODEL_OPTIONS = [
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
] as const;

// ─── Summary Card ────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="bg-bg-surface border border-border rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-text-dim uppercase tracking-wider">
          {label}
        </span>
        <button
          onClick={onEdit}
          className="text-[9px] text-accent hover:underline"
        >
          Edit
        </button>
      </div>
      <span className="text-xs text-text">{value}</span>
    </div>
  );
}

// ─── Main Wizard ─────────────────────────────────────────────────────

export function ScenarioGenerationWizard({
  kbId,
  onGenerated,
  onError,
  onCancel,
}: {
  kbId: Id<"knowledgeBases">;
  onGenerated: (datasetId: Id<"datasets">) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}) {
  const createSimDataset = useMutation(api.crud.datasets.createSimDataset);
  const startGeneration = useMutation(
    api.conversationSim.generation.startGeneration,
  );

  // ── Wizard step ──
  const [step, setStep] = useState(0);

  // ── Step 1: Transcripts ──
  const [selectedUploadIds, setSelectedUploadIds] = useState<
    Id<"livechatUploads">[]
  >([]);
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(
    new Set(),
  );

  // ── Step 2: Configure ──
  const [count, setCount] = useState(10);
  const [distribution, setDistribution] = useState(80);
  const [fidelity, setFidelity] = useState(100);
  const [lowPct, setLowPct] = useState(30);
  const [medPct, setMedPct] = useState(50);
  const [highPct, setHighPct] = useState(20);

  // ── Step 3: Preferences ──
  const [model, setModel] = useState<string>("claude-sonnet-4-20250514");
  const [name, setName] = useState("");

  // ── Step 4: Generate ──
  const [generating, setGenerating] = useState(false);

  // ── Queries ──
  const uploads = useQuery(api.livechat.orchestration.list);
  const conversations = useQuery(
    api.livechat.orchestration.listConversationsSummary,
    selectedUploadIds.length > 0
      ? { uploadIds: selectedUploadIds }
      : "skip",
  );

  // ── Derived values ──
  const hasTranscripts = selectedUploadIds.length > 0;
  const groundedCount = Math.round((count * distribution) / 100);
  const syntheticCount = count - groundedCount;

  // ── Helpers ──

  function toggleUpload(id: Id<"livechatUploads">) {
    setSelectedUploadIds((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id],
    );
    // Clear conversation selection when uploads change
    setSelectedConvIds(new Set());
  }

  function toggleConversation(id: string) {
    setSelectedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllConversations() {
    if (!conversations) return;
    setSelectedConvIds(new Set(conversations.map((c) => c._id)));
  }

  function deselectAllConversations() {
    setSelectedConvIds(new Set());
  }

  function adjustDistribution(
    changed: "low" | "medium" | "high",
    value: number,
  ) {
    const clamped = Math.max(0, Math.min(100, value));
    if (changed === "low") {
      setLowPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        medPct + highPct > 0 ? medPct / (medPct + highPct) : 0.5;
      setMedPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else if (changed === "medium") {
      setMedPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        lowPct + highPct > 0 ? lowPct / (lowPct + highPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else {
      setHighPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        lowPct + medPct > 0 ? lowPct / (lowPct + medPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setMedPct(remaining - Math.round(remaining * ratio));
    }
  }

  async function handleGenerate() {
    if (!name.trim()) return;
    setGenerating(true);
    try {
      const datasetId = await createSimDataset({ kbId, name: name.trim() });
      await startGeneration({
        datasetId,
        count,
        complexityDistribution: {
          low: lowPct / 100,
          medium: medPct / 100,
          high: highPct / 100,
        },
        model,
        transcriptUploadIds:
          selectedUploadIds.length > 0 ? selectedUploadIds : undefined,
        transcriptConversationIds:
          selectedConvIds.size > 0
            ? ([...selectedConvIds] as Id<"livechatConversations">[])
            : undefined,
        distribution: selectedConvIds.size > 0 ? distribution : 0,
        fidelity: selectedConvIds.size > 0 ? fidelity : 100,
        kbId,
      });
      onGenerated(datasetId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // ── Render ──

  return (
    <div className="p-6">
      <h2 className="text-sm font-medium text-text mb-1">
        Generate Conversation Scenarios
      </h2>
      <p className="text-xs text-text-dim mb-4">
        Create diverse conversation scenarios to test your AI agent.
      </p>

      {/* Stepper */}
      <div className="flex items-stretch gap-2 mb-6">
        {STEPS.map((label, i) => {
          const state =
            i === step ? "active" : i < step ? "done" : "pending";
          return (
            <button
              key={label}
              onClick={() => i < step && setStep(i)}
              className="flex-1 flex flex-col items-stretch gap-1.5 group"
            >
              <div
                className={`h-[3px] rounded-sm transition-colors ${
                  state === "active"
                    ? "bg-accent"
                    : state === "done"
                      ? "bg-accent-dim"
                      : "bg-border group-hover:bg-border-bright"
                }`}
              />
              <span
                className={`text-[10px] text-center transition-colors ${
                  state === "active" || state === "done"
                    ? "text-accent"
                    : "text-text-dim"
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="min-h-[280px]">
        {step === 0 && (
          <StepTranscripts
            uploads={uploads}
            conversations={conversations}
            selectedUploadIds={selectedUploadIds}
            selectedConvIds={selectedConvIds}
            onToggleUpload={toggleUpload}
            onToggleConversation={toggleConversation}
            onSelectAll={selectAllConversations}
            onDeselectAll={deselectAllConversations}
          />
        )}
        {step === 1 && (
          <StepConfigure
            count={count}
            onCountChange={setCount}
            distribution={distribution}
            onDistributionChange={setDistribution}
            fidelity={fidelity}
            onFidelityChange={setFidelity}
            hasTranscripts={hasTranscripts}
            groundedCount={groundedCount}
            syntheticCount={syntheticCount}
            lowPct={lowPct}
            medPct={medPct}
            highPct={highPct}
            onAdjustDistribution={adjustDistribution}
          />
        )}
        {step === 2 && (
          <StepPreferences
            kbId={kbId}
            model={model}
            onModelChange={setModel}
            name={name}
            onNameChange={setName}
          />
        )}
        {step === 3 && (
          <StepReview
            selectedConvCount={selectedConvIds.size}
            hasTranscripts={hasTranscripts}
            count={count}
            groundedCount={groundedCount}
            syntheticCount={syntheticCount}
            lowPct={lowPct}
            medPct={medPct}
            highPct={highPct}
            fidelity={fidelity}
            model={model}
            name={name}
            onEdit={setStep}
            onGenerate={handleGenerate}
            generating={generating}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
        <div>
          {step === 0 ? (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step === 0 && (
            <button
              onClick={() => {
                setSelectedUploadIds([]);
                setSelectedConvIds(new Set());
                setStep(1);
              }}
              className="text-xs text-text-dim hover:text-text transition-colors"
            >
              Skip
            </button>
          )}
          {step < 3 && (
            <button
              onClick={() => setStep(step + 1)}
              className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              onClick={handleGenerate}
              disabled={!name.trim() || generating}
              className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Starting..." : `Generate ${count} Scenarios`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Transcript Selection ────────────────────────────────────

function StepTranscripts({
  uploads,
  conversations,
  selectedUploadIds,
  selectedConvIds,
  onToggleUpload,
  onToggleConversation,
  onSelectAll,
  onDeselectAll,
}: {
  uploads:
    | Array<{
        _id: Id<"livechatUploads">;
        filename: string;
        conversationCount?: number;
        status: string;
      }>
    | undefined;
  conversations:
    | Array<{
        _id: Id<"livechatConversations">;
        conversationId: string;
        visitorName: string;
        labels: string[];
        messageCount: number;
      }>
    | undefined;
  selectedUploadIds: Id<"livechatUploads">[];
  selectedConvIds: Set<string>;
  onToggleUpload: (id: Id<"livechatUploads">) => void;
  onToggleConversation: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  if (!uploads || uploads.length === 0) {
    return (
      <div className="text-xs text-text-dim py-8 text-center">
        No conversation transcripts available. You can upload transcripts in
        the Knowledge Base section, or skip to generate synthetic scenarios.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload cards */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
          Transcript Sets
        </label>
        <div className="grid grid-cols-2 gap-2">
          {uploads
            .filter((u) => u.status === "ready")
            .map((upload) => {
              const selected = selectedUploadIds.includes(upload._id);
              return (
                <button
                  key={upload._id}
                  onClick={() => onToggleUpload(upload._id)}
                  className={`text-left p-2 rounded border transition-colors ${
                    selected
                      ? "border-accent bg-accent/10"
                      : "border-border bg-bg-surface hover:border-border-bright"
                  }`}
                >
                  <div className="text-xs text-text truncate">
                    {upload.filename}
                  </div>
                  <div className="text-[10px] text-text-dim mt-0.5">
                    {upload.conversationCount ?? "?"} conversations
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* Conversation table */}
      {selectedUploadIds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] text-text-dim uppercase tracking-wider">
              Conversations
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={onSelectAll}
                className="text-[9px] text-accent hover:underline"
              >
                Select All
              </button>
              <button
                onClick={onDeselectAll}
                className="text-[9px] text-text-dim hover:underline"
              >
                Deselect All
              </button>
            </div>
          </div>

          {!conversations ? (
            <div className="text-[10px] text-text-dim py-4 text-center">
              Loading conversations...
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-[10px] text-text-dim py-4 text-center">
              No conversations found in selected transcripts.
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto border border-border rounded">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border bg-bg-surface">
                    <th className="p-1.5 text-left text-text-dim font-normal w-6" />
                    <th className="p-1.5 text-left text-text-dim font-normal">
                      Conversation
                    </th>
                    <th className="p-1.5 text-left text-text-dim font-normal">
                      Visitor
                    </th>
                    <th className="p-1.5 text-left text-text-dim font-normal">
                      Labels
                    </th>
                    <th className="p-1.5 text-right text-text-dim font-normal">
                      Msgs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conv) => (
                    <tr
                      key={conv._id}
                      className="border-b border-border last:border-0 hover:bg-bg-surface/50"
                    >
                      <td className="p-1.5">
                        <input
                          type="checkbox"
                          checked={selectedConvIds.has(conv._id)}
                          onChange={() => onToggleConversation(conv._id)}
                          className="accent-accent"
                        />
                      </td>
                      <td className="p-1.5 text-text truncate max-w-[120px]">
                        {conv.conversationId}
                      </td>
                      <td className="p-1.5 text-text-dim truncate max-w-[100px]">
                        {conv.visitorName}
                      </td>
                      <td className="p-1.5">
                        <div className="flex flex-wrap gap-0.5">
                          {conv.labels.slice(0, 3).map((label) => (
                            <span
                              key={label}
                              className="px-1.5 py-0.5 text-[9px] rounded border bg-accent/10 text-accent border-accent/20"
                            >
                              {label}
                            </span>
                          ))}
                          {conv.labels.length > 3 && (
                            <span className="text-[9px] text-text-dim">
                              +{conv.labels.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-1.5 text-right text-text-dim">
                        {conv.messageCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Configure ───────────────────────────────────────────────

function StepConfigure({
  count,
  onCountChange,
  distribution,
  onDistributionChange,
  fidelity,
  onFidelityChange,
  hasTranscripts,
  groundedCount,
  syntheticCount,
  lowPct,
  medPct,
  highPct,
  onAdjustDistribution,
}: {
  count: number;
  onCountChange: (v: number) => void;
  distribution: number;
  onDistributionChange: (v: number) => void;
  fidelity: number;
  onFidelityChange: (v: number) => void;
  hasTranscripts: boolean;
  groundedCount: number;
  syntheticCount: number;
  lowPct: number;
  medPct: number;
  highPct: number;
  onAdjustDistribution: (changed: "low" | "medium" | "high", value: number) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Scenario Count */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Number of Scenarios
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={count}
            onChange={(e) => onCountChange(Number(e.target.value))}
            className="flex-1 accent-[#6ee7b7]"
          />
          <span className="text-xs text-text w-8 text-right">{count}</span>
        </div>
      </div>

      {/* Distribution */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Grounded / Synthetic Distribution
        </label>
        {!hasTranscripts ? (
          <div className="text-[10px] text-text-dim bg-bg-surface border border-border rounded p-2">
            No transcripts selected — all scenarios will be synthetic.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={distribution}
                onChange={(e) =>
                  onDistributionChange(Number(e.target.value))
                }
                className="flex-1 accent-[#6ee7b7]"
              />
              <span className="text-xs text-text w-32 text-right">
                {groundedCount} grounded / {syntheticCount} synthetic
              </span>
            </div>
          </>
        )}
      </div>

      {/* Fidelity */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Fidelity
        </label>
        {!hasTranscripts || distribution === 0 ? (
          <div className="text-[10px] text-text-dim bg-bg-surface border border-border rounded p-2">
            {!hasTranscripts
              ? "No transcripts selected."
              : "Distribution set to 0% grounded — fidelity does not apply."}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-dim w-14">Creative</span>
            <input
              type="range"
              min={0}
              max={100}
              value={fidelity}
              onChange={(e) => onFidelityChange(Number(e.target.value))}
              className="flex-1 accent-[#6ee7b7]"
            />
            <span className="text-[10px] text-text-dim w-14 text-right">
              Faithful
            </span>
            <span className="text-xs text-text w-8 text-right">
              {fidelity}%
            </span>
          </div>
        )}
      </div>

      {/* Complexity Distribution */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
          Complexity Distribution
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-green-400">Low</span>
              <span className="text-[10px] text-text-dim">{lowPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={lowPct}
              onChange={(e) =>
                onAdjustDistribution("low", Number(e.target.value))
              }
              className="w-full accent-green-400"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-yellow-400">Medium</span>
              <span className="text-[10px] text-text-dim">{medPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={medPct}
              onChange={(e) =>
                onAdjustDistribution("medium", Number(e.target.value))
              }
              className="w-full accent-yellow-400"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-red-400">High</span>
              <span className="text-[10px] text-text-dim">{highPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={highPct}
              onChange={(e) =>
                onAdjustDistribution("high", Number(e.target.value))
              }
              className="w-full accent-red-400"
            />
          </div>
        </div>
        {/* Distribution bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden mt-2">
          <div className="bg-green-400" style={{ width: `${lowPct}%` }} />
          <div className="bg-yellow-400" style={{ width: `${medPct}%` }} />
          <div className="bg-red-400" style={{ width: `${highPct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Preferences ─────────────────────────────────────────────

function StepPreferences({
  kbId,
  model,
  onModelChange,
  name,
  onNameChange,
}: {
  kbId: Id<"knowledgeBases">;
  model: string;
  onModelChange: (v: string) => void;
  name: string;
  onNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Knowledge Base (read-only) */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Knowledge Base
        </label>
        <div className="text-xs text-text bg-bg-surface border border-border rounded px-3 py-1.5">
          {kbId}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Dataset Name */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Dataset Name
        </label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., Support Scenarios v1"
          className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
        />
        {!name.trim() && (
          <p className="text-[10px] text-red-400 mt-1">
            A dataset name is required before generating.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Review ──────────────────────────────────────────────────

function StepReview({
  selectedConvCount,
  hasTranscripts,
  count,
  groundedCount,
  syntheticCount,
  lowPct,
  medPct,
  highPct,
  fidelity,
  model,
  name,
  onEdit,
  onGenerate,
  generating,
}: {
  selectedConvCount: number;
  hasTranscripts: boolean;
  count: number;
  groundedCount: number;
  syntheticCount: number;
  lowPct: number;
  medPct: number;
  highPct: number;
  fidelity: number;
  model: string;
  name: string;
  onEdit: (step: number) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Dataset name */}
      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Dataset
        </label>
        <div className="text-sm text-text font-medium">
          {name || <span className="text-red-400 italic">No name set</span>}
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard
          label="Transcripts"
          value={
            hasTranscripts
              ? `${selectedConvCount} conversations selected`
              : "Skipped"
          }
          onEdit={() => onEdit(0)}
        />
        <SummaryCard
          label="Count"
          value={`${count} scenarios`}
          onEdit={() => onEdit(1)}
        />
        <SummaryCard
          label="Distribution"
          value={
            hasTranscripts
              ? `${groundedCount} grounded / ${syntheticCount} synthetic`
              : `${count} synthetic`
          }
          onEdit={() => onEdit(1)}
        />
        <SummaryCard
          label="Complexity"
          value={`Low ${lowPct}% / Med ${medPct}% / High ${highPct}%`}
          onEdit={() => onEdit(1)}
        />
        <SummaryCard
          label="Fidelity"
          value={hasTranscripts && groundedCount > 0 ? `${fidelity}%` : "N/A"}
          onEdit={() => onEdit(1)}
        />
        <SummaryCard
          label="Model"
          value={model}
          onEdit={() => onEdit(2)}
        />
      </div>
    </div>
  );
}
