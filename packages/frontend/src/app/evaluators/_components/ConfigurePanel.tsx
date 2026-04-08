"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id, Doc } from "@convex/_generated/dataModel";

const MODEL_GROUPS: Array<{
  label: string;
  models: Array<{ id: string; label: string }>;
}> = [
  {
    label: "Claude (Anthropic)",
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    label: "OpenAI",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
      { id: "o3", label: "o3" },
      { id: "o4-mini", label: "o4-mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "text-text-dim" },
  validating: { label: "Validating", color: "text-yellow-400" },
  validated: { label: "Validated", color: "text-blue-400" },
  ready: { label: "Ready", color: "text-accent" },
};

interface ConfigurePanelProps {
  config: Doc<"evaluatorConfigs">;
  experimentId: Id<"experiments">;
}

export function ConfigurePanel({ config, experimentId }: ConfigurePanelProps) {
  const updateConfig = useMutation(api.evaluator.crud.updateConfig);

  const [editPrompt, setEditPrompt] = useState(config.judgePrompt);
  const [editModel, setEditModel] = useState(config.modelId);
  const [showPreview, setShowPreview] = useState(false);

  // Sync local state when config changes (e.g., user picks a different evaluator)
  useEffect(() => {
    setEditPrompt(config.judgePrompt);
    setEditModel(config.modelId);
  }, [config._id, config.judgePrompt, config.modelId]);

  const annotations = useQuery(api.annotations.crud.byExperiment, {
    experimentId,
  });

  const experiment = useQuery(api.experiments.orchestration.get, {
    id: experimentId,
  });
  const questions = useQuery(
    api.crud.questions.byDataset,
    experiment?.datasetId ? { datasetId: experiment.datasetId } : "skip",
  );
  const questionMap = new Map(
    (questions ?? []).map((q) => [q._id, q]),
  );

  const handleSave = async () => {
    await updateConfig({
      id: config._id,
      judgePrompt: editPrompt,
      modelId: editModel,
    });
  };

  const hasUnsavedChanges =
    editPrompt !== config.judgePrompt || editModel !== config.modelId;

  return (
    <div className="flex-1 overflow-y-auto p-6 min-h-0">
      <div className="max-w-3xl space-y-6 pb-12">
        {/* Status header */}
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${STATUS_LABELS[config.status]?.color}`}
          >
            {STATUS_LABELS[config.status]?.label}
          </span>
          <span className="text-xs text-text-dim">
            Split: {config.splitConfig.trainPct}/{config.splitConfig.devPct}/
            {config.splitConfig.testPct} (train/dev/test)
          </span>
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-xs font-medium text-text-dim mb-1.5">
            Judge Model
          </label>
          <select
            value={editModel}
            onChange={(e) => setEditModel(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text"
          >
            {MODEL_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Judge prompt */}
        <div>
          <label className="block text-xs font-medium text-text-dim mb-1.5">
            Judge Prompt
          </label>
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={16}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text font-mono resize-y"
          />
        </div>

        {/* Few-shot examples */}
        <div>
          <label className="block text-xs font-medium text-text-dim mb-1.5">
            Few-Shot Examples ({config.fewShotExampleIds.length} selected from
            training split)
          </label>
          {config.fewShotExampleIds.length === 0 ? (
            <p className="text-xs text-text-dim">
              No few-shot examples selected. The evaluator will use zero-shot
              judgment.
            </p>
          ) : (
            <div className="space-y-2">
              {config.fewShotExampleIds.map((qId) => {
                const q = questionMap.get(qId);
                const ann = (annotations ?? []).find(
                  (a) => a.questionId === qId,
                );
                return (
                  <div
                    key={qId}
                    className="text-xs bg-bg-elevated border border-border rounded-lg px-3 py-2"
                  >
                    <span className="text-text">
                      {q?.queryText?.slice(0, 80) ?? "Unknown question"}
                    </span>
                    {ann && (
                      <span
                        className={`ml-2 ${
                          ann.rating === "pass" ||
                          ann.rating === "great" ||
                          ann.rating === "good_enough"
                            ? "text-accent"
                            : "text-red-400"
                        }`}
                      >
                        {ann.rating === "pass" ||
                        ann.rating === "great" ||
                        ann.rating === "good_enough"
                          ? "Pass"
                          : "Fail"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview */}
        <div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs text-accent hover:underline"
          >
            {showPreview ? "Hide" : "Show"} Full Prompt Preview
          </button>
          {showPreview && (
            <pre className="mt-2 bg-bg-elevated border border-border rounded-lg p-3 text-xs text-text-dim overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
              {editPrompt}
              {"\n\n--- Few-shot examples would be inserted here ---\n\n"}
              {"Now evaluate:\nQuestion: {question}\nAgent Answer: {answer}\nRetrieved Context: {context}"}
            </pre>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
            className="px-4 py-2 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save Changes
          </button>
          {hasUnsavedChanges && (
            <span className="text-xs text-yellow-400">Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}
