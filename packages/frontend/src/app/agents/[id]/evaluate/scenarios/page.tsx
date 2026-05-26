"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

type Doc = NonNullable<ReturnType<typeof useQuery<typeof api.conversationSim.scenarios.byAgent>>>[number];

const SOURCE_KIND_BADGE: Record<string, string> = {
  synthetic: "bg-accent/15 text-accent",
  grounded: "bg-blue-500/15 text-blue-400",
  manual: "bg-border text-text-dim",
};

function ScenarioRow({
  scenario,
  onDelete,
}: {
  scenario: Doc;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const instructionPreview =
    scenario.instruction.length > 60
      ? scenario.instruction.slice(0, 60) + "…"
      : scenario.instruction;

  const sourceKind = scenario.source.kind;
  const badgeCls = SOURCE_KIND_BADGE[sourceKind] ?? "bg-border text-text-dim";

  const createdDate = new Date(scenario.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="border border-border rounded-lg bg-bg-elevated overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-bg-surface transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text truncate">{instructionPreview}</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeCls}`}
            >
              {sourceKind}
            </span>
            <span className="text-[10px] text-text-dim">{createdDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-[10px] text-text-dim hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
          >
            Delete
          </button>
          <span className="text-text-dim text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
              Instruction
            </p>
            <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">
              {scenario.instruction}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Topic</p>
              <p className="text-xs text-text">{scenario.topic}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Intent</p>
              <p className="text-xs text-text">{scenario.intent}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Complexity</p>
              <p className="text-xs text-text capitalize">{scenario.complexity}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Persona</p>
              <p className="text-xs text-text">{scenario.persona.type}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_FORM = {
  topic: "",
  intent: "",
  instruction: "",
  reasonForContact: "",
  knownInfo: "",
  unknownInfo: "",
  complexity: "medium" as "low" | "medium" | "high",
  personaType: "customer",
};

function AddScenarioModal({
  agentId,
  onClose,
}: {
  agentId: Id<"agents">;
  onClose: () => void;
}) {
  const createScenario = useMutation(api.conversationSim.scenarios.create);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof DEFAULT_FORM, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.topic || !form.intent || !form.instruction) return;
    setSaving(true);
    setError(null);
    try {
      await createScenario({
        agentId,
        source: { kind: "manual" },
        topic: form.topic,
        intent: form.intent,
        instruction: form.instruction,
        reasonForContact: form.reasonForContact || form.topic,
        knownInfo: form.knownInfo || "None specified",
        unknownInfo: form.unknownInfo || "None specified",
        complexity: form.complexity,
        persona: {
          type: form.personaType || "customer",
          traits: [],
          communicationStyle: "neutral",
          patienceLevel: "medium",
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scenario");
      setSaving(false);
    }
  }

  const inputCls =
    "w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none placeholder:text-text-dim";
  const labelCls = "block text-[11px] uppercase tracking-wider text-text-dim mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-text">Add Scenario</h2>
          <p className="text-xs text-text-dim mt-1">
            Create a manual scenario for simulation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className={labelCls}>Topic *</label>
            <input
              className={inputCls}
              placeholder="e.g. Billing dispute"
              value={form.topic}
              onChange={(e) => set("topic", e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Intent *</label>
            <input
              className={inputCls}
              placeholder="e.g. Get refund for incorrect charge"
              value={form.intent}
              onChange={(e) => set("intent", e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Instruction *</label>
            <textarea
              className={`${inputCls} resize-y min-h-[80px]`}
              placeholder="Describe how the simulated user should behave in this conversation…"
              value={form.instruction}
              onChange={(e) => set("instruction", e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Reason for Contact</label>
            <input
              className={inputCls}
              placeholder="Defaults to topic if blank"
              value={form.reasonForContact}
              onChange={(e) => set("reasonForContact", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Known Info</label>
              <input
                className={inputCls}
                placeholder="What the user already knows"
                value={form.knownInfo}
                onChange={(e) => set("knownInfo", e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Unknown Info</label>
              <input
                className={inputCls}
                placeholder="What the user doesn't know"
                value={form.unknownInfo}
                onChange={(e) => set("unknownInfo", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Complexity</label>
              <select
                className={inputCls}
                value={form.complexity}
                onChange={(e) =>
                  set("complexity", e.target.value as "low" | "medium" | "high")
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Persona Type</label>
              <input
                className={inputCls}
                placeholder="e.g. customer, student"
                value={form.personaType}
                onChange={(e) => set("personaType", e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Creating…" : "Create Scenario"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ScenariosPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;

  const scenarios = useQuery(api.conversationSim.scenarios.byAgent, { agentId });
  const removeScenario = useMutation(api.conversationSim.scenarios.remove);

  const [showModal, setShowModal] = useState(false);

  async function handleDelete(id: Id<"conversationScenarios">) {
    if (!confirm("Delete this scenario?")) return;
    await removeScenario({ id });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-medium text-text">Scenarios</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          <span>+</span> Add scenario
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {scenarios === undefined ? (
          /* Loading skeleton */
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : scenarios.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No scenarios yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &lsquo;+ Add scenario&rsquo; to create one.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {scenarios.map((scenario) => (
              <ScenarioRow
                key={scenario._id}
                scenario={scenario}
                onDelete={() => handleDelete(scenario._id)}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddScenarioModal agentId={agentId} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
