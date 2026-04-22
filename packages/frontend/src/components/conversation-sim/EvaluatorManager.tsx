"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";

export function EvaluatorManager({
  onClose,
}: {
  onClose?: () => void;
}) {
  const evaluators = useQuery(api.conversationSim.evaluators.byOrg) ?? [];
  const evaluatorSets = useQuery(api.conversationSim.evaluatorSets.byOrg) ?? [];
  const createEvaluator = useMutation(api.conversationSim.evaluators.create);
  const removeEvaluator = useMutation(api.conversationSim.evaluators.remove);
  const seedTemplates = useMutation(api.conversationSim.evaluators.seedTemplates);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [tab, setTab] = useState<"evaluators" | "sets">("evaluators");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-text">
            Evaluator Management
          </h2>
          <div className="flex items-center gap-2">
            {evaluators.length === 0 && (
              <button
                onClick={() => seedTemplates()}
                className="px-3 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
              >
                Seed Templates
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-text-dim hover:text-text text-xs"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 px-6 py-2 border-b border-border">
          <button
            onClick={() => setTab("evaluators")}
            className={`text-xs pb-1 border-b-2 transition-colors ${
              tab === "evaluators"
                ? "border-accent text-accent"
                : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            Evaluators ({evaluators.length})
          </button>
          <button
            onClick={() => setTab("sets")}
            className={`text-xs pb-1 border-b-2 transition-colors ${
              tab === "sets"
                ? "border-accent text-accent"
                : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            Sets ({evaluatorSets.length})
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-120px)]">
          {tab === "evaluators" ? (
            <div className="px-6 py-3">
              {/* Evaluator list */}
              <div className="space-y-2">
                {evaluators.map((ev) => (
                  <div
                    key={ev._id}
                    className="flex items-center justify-between bg-bg border border-border rounded-md p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text font-medium">
                          {ev.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-[9px] rounded border ${
                            ev.type === "code"
                              ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
                              : "bg-purple-500/15 text-purple-400 border-purple-500/20"
                          }`}
                        >
                          {ev.type === "code" ? "Code" : "LLM Judge"}
                        </span>
                        <span className="px-1.5 py-0.5 text-[9px] rounded bg-white/5 text-text-dim border border-border">
                          {ev.scope}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-dim mt-0.5 truncate">
                        {ev.description}
                      </p>
                      {ev.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {ev.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1 py-0.5 text-[8px] text-text-dim bg-white/5 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeEvaluator({ id: ev._id })}
                      className="ml-2 p-1 text-text-dim hover:text-red-400 transition-colors"
                      title="Delete evaluator"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Create button */}
              {!showCreateForm && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="mt-3 w-full py-2 text-xs text-text-dim border border-dashed border-border rounded hover:text-accent hover:border-accent/30 transition-colors"
                >
                  + Add Evaluator
                </button>
              )}

              {/* Create form (simplified -- code evaluators only) */}
              {showCreateForm && (
                <CreateEvaluatorForm
                  onCreate={async (data) => {
                    await createEvaluator(data);
                    setShowCreateForm(false);
                  }}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
            </div>
          ) : (
            <div className="px-6 py-3">
              {evaluatorSets.map((es) => (
                <div
                  key={es._id}
                  className="bg-bg border border-border rounded-md p-3 mb-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text font-medium">
                      {es.name}
                    </span>
                    <span className="text-[10px] text-text-dim">
                      {es.evaluatorIds.length} evaluators &middot;{" "}
                      {es.requiredEvaluatorIds.length} required &middot;
                      threshold {(es.passThreshold * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-text-dim mt-0.5">
                    {es.description}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateEvaluatorForm({
  onCreate,
  onCancel,
}: {
  onCreate: (data: {
    name: string;
    description: string;
    type: "code";
    scope: "session" | "turn";
    codeConfig: {
      checkType:
        | "tool_call_match"
        | "string_contains"
        | "regex_match"
        | "response_format";
      params: Record<string, unknown>;
    };
    createdFrom: "manual";
    tags: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"session" | "turn">("session");
  const [checkType, setCheckType] = useState<
    "tool_call_match" | "string_contains" | "regex_match" | "response_format"
  >("tool_call_match");
  const [saving, setSaving] = useState(false);

  function defaultParams(
    ct: typeof checkType,
  ): Record<string, unknown> {
    switch (ct) {
      case "tool_call_match":
        return { minCalls: 1 };
      case "string_contains":
        return { target: "", caseSensitive: false, searchIn: "agent_messages" };
      case "regex_match":
        return {
          pattern: "",
          searchIn: "agent_messages",
          shouldMatch: true,
        };
      case "response_format":
        return { requireNonEmpty: true };
    }
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        description:
          description.trim() || `Code evaluator: ${checkType}`,
        type: "code" as const,
        scope,
        codeConfig: {
          checkType,
          params: defaultParams(checkType),
        },
        createdFrom: "manual" as const,
        tags: [],
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 bg-bg border border-accent/20 rounded-md p-3 space-y-3">
      <div className="text-[11px] text-accent font-medium">
        New Code Evaluator
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Evaluator name"
        className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={checkType}
          onChange={(e) => setCheckType(e.target.value as typeof checkType)}
          className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
        >
          <option value="tool_call_match">Tool Call Match</option>
          <option value="string_contains">String Contains</option>
          <option value="regex_match">Regex Match</option>
          <option value="response_format">Response Format</option>
        </select>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
        >
          <option value="session">Session</option>
          <option value="turn">Turn</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || saving}
          className="px-3 py-1 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-text-dim border border-border rounded hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
