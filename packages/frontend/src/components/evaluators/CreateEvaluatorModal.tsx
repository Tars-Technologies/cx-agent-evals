"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

interface CreateEvaluatorModalProps {
  agentId: Id<"agents">;
  onClose(): void;
  onCreated(newId: Id<"evaluators">): void;
}

type PathChoice = "blank" | "template" | null;
type EvaluatorType = "code" | "llm_judge";
type InputContextOption = "transcript" | "tool_calls" | "kb_documents";

const INPUT_CONTEXT_OPTIONS: { value: InputContextOption; label: string }[] = [
  { value: "transcript", label: "Transcript" },
  { value: "tool_calls", label: "Tool calls" },
  { value: "kb_documents", label: "KB documents" },
];

// ─── Path A: Blank form ───

function BlankForm({
  agentId,
  onCreated,
  onBack,
}: {
  agentId: Id<"agents">;
  onCreated(newId: Id<"evaluators">): void;
  onBack(): void;
}) {
  const createEvaluator = useMutation(api.evaluator.crud.create);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<EvaluatorType>("llm_judge");

  // code config
  const [needle, setNeedle] = useState("");

  // llm_judge config
  const [dimensionName, setDimensionName] = useState("");
  const [rubric, setRubric] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [inputContext, setInputContext] = useState<InputContextOption[]>([
    "transcript",
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleContext(value: InputContextOption) {
    setInputContext((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let newId: Id<"evaluators">;
      if (type === "code") {
        newId = await createEvaluator({
          agentId,
          name: name.trim(),
          description: description.trim(),
          type: "code",
          codeJudgeConfig: {
            checkType: "string_contains",
            params: { needle: needle.trim() },
          },
          source: { kind: "manual" },
          tags: [],
        });
      } else {
        newId = await createEvaluator({
          agentId,
          name: name.trim(),
          description: description.trim(),
          type: "llm_judge",
          llmJudgeConfig: {
            dimensions: [
              {
                name: dimensionName.trim() || name.trim(),
                rubric: rubric.trim(),
                passExamples: [],
                failExamples: [],
              },
            ],
            outputFormat: "per_dimension",
            model: model.trim(),
            inputContext,
          },
          source: { kind: "manual" },
          tags: [],
        });
      }
      onCreated(newId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create evaluator.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Name */}
      <div>
        <label className="block text-xs text-text-dim mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Response accuracy"
          className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text placeholder:text-text-muted"
          autoFocus
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs text-text-dim mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What does this evaluator measure?"
          className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text placeholder:text-text-muted resize-none"
        />
      </div>

      {/* Type */}
      <div>
        <label className="block text-xs text-text-dim mb-2">Type</label>
        <div className="flex gap-3">
          {(["llm_judge", "code"] as EvaluatorType[]).map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="accent-accent"
              />
              <span className="text-xs text-text">
                {t === "llm_judge" ? "LLM judge" : "Code"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Code config */}
      {type === "code" && (
        <div>
          <label className="block text-xs text-text-dim mb-1">
            Needle to match (string_contains)
          </label>
          <input
            type="text"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="e.g. thank you"
            className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text placeholder:text-text-muted"
          />
        </div>
      )}

      {/* LLM judge config */}
      {type === "llm_judge" && (
        <div className="flex flex-col gap-3 border border-border rounded p-3 bg-bg-surface/50">
          <p className="text-[10px] uppercase tracking-wider text-text-dim">
            Dimension
          </p>
          <div>
            <label className="block text-xs text-text-dim mb-1">
              Dimension name
            </label>
            <input
              type="text"
              value={dimensionName}
              onChange={(e) => setDimensionName(e.target.value)}
              placeholder="Same as evaluator name if blank"
              className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text placeholder:text-text-muted"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Rubric</label>
            <textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={3}
              placeholder="Describe when the agent passes or fails this dimension…"
              className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text placeholder:text-text-muted resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-bg-surface border border-border rounded focus:outline-none focus:border-accent text-text"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-2">
              Input context
            </label>
            <div className="flex gap-4 flex-wrap">
              {INPUT_CONTEXT_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputContext.includes(value)}
                    onChange={() => toggleContext(value)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-text">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-between pt-1">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create evaluator"}
        </button>
      </div>
    </form>
  );
}

// ─── Path B: From template ───

type Template = NonNullable<
  ReturnType<typeof useQuery<typeof api.evaluator.templates.listAll>>
>[number];

function TemplateCard({
  template,
  onSelect,
}: {
  template: Template;
  onSelect(t: Template): void;
}) {
  return (
    <button
      onClick={() => onSelect(template)}
      className="w-full text-left px-4 py-3 border border-border rounded-lg bg-bg-elevated hover:bg-bg-surface hover:border-accent/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-text font-medium">{template.name}</p>
        <span className="text-[10px] px-1.5 py-0.5 bg-border rounded text-text-dim shrink-0">
          {template.category}
        </span>
      </div>
      {template.description && (
        <p className="text-[11px] text-text-dim mt-1 line-clamp-2">
          {template.description}
        </p>
      )}
    </button>
  );
}

function TemplateList({
  agentId,
  onCreated,
  onBack,
}: {
  agentId: Id<"agents">;
  onCreated(newId: Id<"evaluators">): void;
  onBack(): void;
}) {
  const templates = useQuery(api.evaluator.templates.listAll, {});
  const createFromTemplate = useMutation(api.evaluator.crud.createFromTemplate);

  const [selected, setSelected] = useState<Template | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const newId = await createFromTemplate({
        agentId,
        templateId: selected._id,
      });
      onCreated(newId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create evaluator.");
      setSubmitting(false);
    }
  }

  // Group by category
  const grouped: Record<string, Template[]> = {};
  if (templates) {
    for (const t of templates) {
      const cat = t.category ?? "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border border-border rounded-lg bg-bg-elevated px-4 py-3">
          <p className="text-xs text-text font-medium">{selected.name}</p>
          {selected.description && (
            <p className="text-[11px] text-text-dim mt-1">{selected.description}</p>
          )}
          <span className="text-[10px] px-1.5 py-0.5 bg-border rounded text-text-dim mt-2 inline-block">
            {selected.category}
          </span>
        </div>
        <p className="text-xs text-text-dim">
          Create an evaluator from this template?
        </p>
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors"
          >
            ← Choose another
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create from template"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {templates === undefined ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg bg-bg-elevated border border-border animate-pulse"
            />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-text-dim text-center py-8">
          No templates available.
        </p>
      ) : (
        <div className="flex flex-col gap-4 max-h-[360px] overflow-y-auto pr-1">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] uppercase tracking-wider text-text-dim mb-2">
                {category}
              </p>
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <TemplateCard key={t._id} template={t} onSelect={setSelected} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-start">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

// ─── Step 1: Choose path ───

function PathChooser({ onChoose }: { onChoose(path: PathChoice): void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-dim">How would you like to create this evaluator?</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChoose("blank")}
          className="flex flex-col items-center gap-2 px-4 py-5 border border-border rounded-lg bg-bg-elevated hover:bg-bg-surface hover:border-accent/50 transition-colors"
        >
          <span className="text-lg">✏️</span>
          <span className="text-xs font-medium text-text">Start blank</span>
          <span className="text-[10px] text-text-dim text-center">
            Define your own rubric or code check
          </span>
        </button>
        <button
          onClick={() => onChoose("template")}
          className="flex flex-col items-center gap-2 px-4 py-5 border border-border rounded-lg bg-bg-elevated hover:bg-bg-surface hover:border-accent/50 transition-colors"
        >
          <span className="text-lg">📋</span>
          <span className="text-xs font-medium text-text">From template</span>
          <span className="text-[10px] text-text-dim text-center">
            Pick from pre-built evaluator templates
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Modal root ───

export function CreateEvaluatorModal({
  agentId,
  onClose,
  onCreated,
}: CreateEvaluatorModalProps) {
  const [path, setPath] = useState<PathChoice>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-medium text-text">New evaluator</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors w-6 h-6 flex items-center justify-center rounded"
          >
            ✕
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {path === null && <PathChooser onChoose={setPath} />}
          {path === "blank" && (
            <BlankForm
              agentId={agentId}
              onCreated={onCreated}
              onBack={() => setPath(null)}
            />
          )}
          {path === "template" && (
            <TemplateList
              agentId={agentId}
              onCreated={onCreated}
              onBack={() => setPath(null)}
            />
          )}
        </div>

        {/* Footer cancel — only shown on step 1 */}
        {path === null && (
          <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-text-dim hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
