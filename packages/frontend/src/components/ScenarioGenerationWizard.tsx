"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

const STEPS = ["Inputs", "Configure", "Preferences", "Review"] as const;

const MODEL_OPTIONS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
] as const;

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
        <button onClick={onEdit} className="text-[9px] text-accent hover:underline">
          Edit
        </button>
      </div>
      <span className="text-xs text-text">{value}</span>
    </div>
  );
}

export function ScenarioGenerationWizard({
  agentId,
  onGenerated,
  onError,
  onCancel,
}: {
  agentId: Id<"agents">;
  onGenerated: () => void;
  onError: (error: string) => void;
  onCancel: () => void;
}) {
  const startGeneration = useMutation(
    api.conversationSim.generation.startGeneration,
  );

  const [step, setStep] = useState(0);

  // Step 0: Inputs
  const [selectedKbId, setSelectedKbId] = useState<Id<"knowledgeBases"> | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<Id<"livechatUploads"> | null>(null);
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());

  // Step 1: Configure
  const [count, setCount] = useState(10);
  const [distribution, setDistribution] = useState(50); // % grounded
  const [fidelity, setFidelity] = useState(70);
  const [lowPct, setLowPct] = useState(30);
  const [medPct, setMedPct] = useState(50);
  const [highPct, setHighPct] = useState(20);

  // Step 2: Preferences
  const [model, setModel] = useState<string>("claude-sonnet-4-6");

  const [generating, setGenerating] = useState(false);

  const kbs = useQuery(api.crud.knowledgeBases.list);
  const uploads = useQuery(api.livechat.orchestration.list);
  const conversations = useQuery(
    api.livechat.orchestration.listConversationsSummary,
    selectedUploadId ? { uploadIds: [selectedUploadId] } : "skip",
  );

  const hasTranscripts =
    selectedUploadId !== null && selectedConvIds.size > 0;
  const effectiveDistribution = hasTranscripts ? distribution : 0;
  const groundedCount = Math.round((count * effectiveDistribution) / 100);
  const syntheticCount = count - groundedCount;
  const needsKb = syntheticCount > 0;
  const canAdvanceFromInputs =
    (!!selectedKbId || hasTranscripts) &&
    (!needsKb || !!selectedKbId);

  function toggleConversation(id: string) {
    setSelectedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllConversations() {
    if (!conversations) return;
    const allIds = conversations.map((c) => c._id);
    const allSelected = allIds.every((id) => selectedConvIds.has(id));
    setSelectedConvIds(allSelected ? new Set() : new Set(allIds));
  }

  function adjustDistribution(changed: "low" | "medium" | "high", value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    if (changed === "low") {
      setLowPct(clamped);
      const remaining = 100 - clamped;
      const ratio = medPct + highPct > 0 ? medPct / (medPct + highPct) : 0.5;
      setMedPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else if (changed === "medium") {
      setMedPct(clamped);
      const remaining = 100 - clamped;
      const ratio = lowPct + highPct > 0 ? lowPct / (lowPct + highPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else {
      setHighPct(clamped);
      const remaining = 100 - clamped;
      const ratio = lowPct + medPct > 0 ? lowPct / (lowPct + medPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setMedPct(remaining - Math.round(remaining * ratio));
    }
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      await startGeneration({
        agentId,
        kbId: selectedKbId ?? undefined,
        transcriptUploadId: hasTranscripts
          ? (selectedUploadId ?? undefined)
          : undefined,
        count,
        complexityDistribution: {
          low: lowPct / 100,
          medium: medPct / 100,
          high: highPct / 100,
        },
        model,
        transcriptConversationIds: hasTranscripts
          ? ([...selectedConvIds] as Id<"livechatConversations">[])
          : undefined,
        distribution: effectiveDistribution,
        fidelity,
      });
      onGenerated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-sm font-medium text-text mb-1">
        Generate Conversation Scenarios
      </h2>
      <p className="text-xs text-text-dim mb-4">
        Generate diverse scenarios from your knowledge base, real transcripts, or a mix of both.
      </p>

      <div className="flex items-stretch gap-2 mb-6">
        {STEPS.map((label, i) => {
          const state = i === step ? "active" : i < step ? "done" : "pending";
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

      <div className="min-h-[280px]">
        {step === 0 && (
          <StepInputs
            kbs={kbs}
            selectedKbId={selectedKbId}
            onSelectKb={setSelectedKbId}
            uploads={uploads}
            selectedUploadId={selectedUploadId}
            onSelectUpload={(id) => {
              setSelectedUploadId(id);
              setSelectedConvIds(new Set());
            }}
            conversations={conversations}
            selectedConvIds={selectedConvIds}
            onToggleConversation={toggleConversation}
            onToggleAllConversations={toggleAllConversations}
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
          <StepPreferences model={model} onModelChange={setModel} />
        )}
        {step === 3 && (
          <StepReview
            selectedKbName={kbs?.find((k) => k._id === selectedKbId)?.name ?? "—"}
            hasKb={!!selectedKbId}
            selectedUploadName={
              uploads?.find((u) => u._id === selectedUploadId)?.filename ?? "—"
            }
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
            onEdit={setStep}
          />
        )}
      </div>

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
          {step < 3 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !canAdvanceFromInputs}
              className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Starting…" : `Generate ${count} scenarios`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepInputs({
  kbs,
  selectedKbId,
  onSelectKb,
  uploads,
  selectedUploadId,
  onSelectUpload,
  conversations,
  selectedConvIds,
  onToggleConversation,
  onToggleAllConversations,
}: {
  kbs: Array<{ _id: Id<"knowledgeBases">; name: string }> | undefined;
  selectedKbId: Id<"knowledgeBases"> | null;
  onSelectKb: (id: Id<"knowledgeBases"> | null) => void;
  uploads:
    | Array<{ _id: Id<"livechatUploads">; filename: string; status: string; conversationCount?: number }>
    | undefined;
  selectedUploadId: Id<"livechatUploads"> | null;
  onSelectUpload: (id: Id<"livechatUploads"> | null) => void;
  conversations:
    | Array<{
        _id: Id<"livechatConversations">;
        conversationId: string;
        visitorName: string;
        labels: string[];
        messageCount: number;
      }>
    | undefined;
  selectedConvIds: Set<string>;
  onToggleConversation: (id: string) => void;
  onToggleAllConversations: () => void;
}) {
  const readyUploads = (uploads ?? []).filter((u) => u.status === "ready");
  const totalConvs = conversations?.length ?? 0;
  const selectedCount = conversations
    ? conversations.filter((c) => selectedConvIds.has(c._id)).length
    : 0;
  const allSelected = totalConvs > 0 && selectedCount === totalConvs;
  const someSelected = selectedCount > 0 && selectedCount < totalConvs;

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-text-dim">
        Pick a knowledge base for synthetic scenarios, transcripts for grounded scenarios, or both for a mix.
      </p>

      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
          Knowledge Base (for synthetic scenarios)
        </label>
        {!kbs || kbs.length === 0 ? (
          <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
            No knowledge bases available.
          </div>
        ) : (
          <select
            value={selectedKbId ?? ""}
            onChange={(e) =>
              onSelectKb(
                e.target.value
                  ? (e.target.value as Id<"knowledgeBases">)
                  : null,
              )
            }
            className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
          >
            <option value="">None — grounded only</option>
            {kbs.map((kb) => (
              <option key={kb._id} value={kb._id}>
                {kb.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
          Transcript Upload (optional; for grounded scenarios)
        </label>
        {readyUploads.length === 0 ? (
          <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
            No ready transcript uploads.
          </div>
        ) : (
          <select
            value={selectedUploadId ?? ""}
            onChange={(e) =>
              onSelectUpload(
                e.target.value
                  ? (e.target.value as Id<"livechatUploads">)
                  : null,
              )
            }
            className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
          >
            <option value="">None — synthetic only</option>
            {readyUploads.map((u) => (
              <option key={u._id} value={u._id}>
                {u.filename} ({u.conversationCount ?? "?"} convs)
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedUploadId && (
        <div>
          <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Conversations
            {totalConvs > 0 && (
              <span className="text-text-muted ml-1">
                ({selectedCount}/{totalConvs} selected)
              </span>
            )}
          </label>
          {!conversations ? (
            <div className="text-[10px] text-text-dim py-4 text-center">
              Loading conversations…
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-[10px] text-text-dim py-4 text-center">
              No conversations found.
            </div>
          ) : (
            <div className="max-h-[180px] overflow-y-auto border border-border rounded">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border bg-bg-surface sticky top-0">
                    <th className="p-1.5 text-left w-6">
                      <TriStateCheckbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={onToggleAllConversations}
                      />
                    </th>
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
                      className="border-b border-border last:border-0 hover:bg-bg-surface/50 cursor-pointer"
                      onClick={() => onToggleConversation(conv._id)}
                    >
                      <td className="p-1.5" onClick={(e) => e.stopPropagation()}>
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

function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="accent-accent"
    />
  );
}

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

      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Synthetic / Grounded Mix
        </label>
        {!hasTranscripts ? (
          <div className="text-[10px] text-text-dim bg-bg-surface border border-border rounded p-2">
            No transcripts selected — all {count} scenarios will be synthetic.
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={distribution}
              onChange={(e) => onDistributionChange(Number(e.target.value))}
              className="flex-1 accent-[#6ee7b7]"
            />
            <span className="text-xs text-text w-40 text-right">
              {groundedCount} grounded / {syntheticCount} synthetic
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
          Fidelity
        </label>
        {!hasTranscripts || groundedCount === 0 ? (
          <div className="text-[10px] text-text-dim bg-bg-surface border border-border rounded p-2">
            {!hasTranscripts
              ? "No transcripts selected — fidelity does not apply."
              : "0% grounded — fidelity does not apply."}
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
            <span className="text-xs text-text w-8 text-right">{fidelity}%</span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
          Complexity Distribution
        </label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "low" as const, label: "Low", val: lowPct, color: "green" },
            { key: "medium" as const, label: "Medium", val: medPct, color: "yellow" },
            { key: "high" as const, label: "High", val: highPct, color: "red" },
          ]).map(({ key, label, val, color }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] text-${color}-400`}>{label}</span>
                <span className="text-[10px] text-text-dim">{val}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={val}
                onChange={(e) => onAdjustDistribution(key, Number(e.target.value))}
                className={`w-full accent-${color}-400`}
              />
            </div>
          ))}
        </div>
        <div className="flex h-1.5 rounded-full overflow-hidden mt-2">
          <div className="bg-green-400" style={{ width: `${lowPct}%` }} />
          <div className="bg-yellow-400" style={{ width: `${medPct}%` }} />
          <div className="bg-red-400" style={{ width: `${highPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function StepPreferences({
  model,
  onModelChange,
}: {
  model: string;
  onModelChange: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
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
    </div>
  );
}

function StepReview({
  selectedKbName,
  hasKb,
  selectedUploadName,
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
  onEdit,
}: {
  selectedKbName: string;
  hasKb: boolean;
  selectedUploadName: string;
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
  onEdit: (step: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard
          label="Knowledge Base"
          value={hasKb ? selectedKbName : "—"}
          onEdit={() => onEdit(0)}
        />
        <SummaryCard
          label="Transcripts"
          value={
            hasTranscripts
              ? `${selectedUploadName} · ${selectedConvCount} convs`
              : "—"
          }
          onEdit={() => onEdit(0)}
        />
        <SummaryCard
          label="Count"
          value={`${count} scenarios`}
          onEdit={() => onEdit(1)}
        />
        <SummaryCard
          label="Mix"
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
          value={hasTranscripts && groundedCount > 0 ? `${fidelity}%` : "—"}
          onEdit={() => onEdit(1)}
        />
        <SummaryCard label="Model" value={model} onEdit={() => onEdit(2)} />
      </div>
    </div>
  );
}
