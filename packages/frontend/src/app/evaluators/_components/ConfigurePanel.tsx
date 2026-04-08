"use client";

import { useState, useEffect, useMemo } from "react";
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

const DEFAULT_OUTPUT_FORMAT = `{
  "reasoning": "<brief 1-2 sentence explanation>",
  "answer": "Pass" | "Fail"
}`;

interface ConfigurePanelProps {
  config: Doc<"evaluatorConfigs">;
  experimentId: Id<"experiments">;
}

type RightPaneMode = "editor" | "preview";

export function ConfigurePanel({ config, experimentId }: ConfigurePanelProps) {
  const updateConfig = useMutation(api.evaluator.crud.updateConfig);

  // Local edit state
  const [editName, setEditName] = useState(config.name);
  const [editFmId, setEditFmId] = useState<Id<"failureModes">>(
    config.failureModeId,
  );
  const [editModel, setEditModel] = useState(config.modelId);
  const [editOutputFormat, setEditOutputFormat] = useState(
    config.outputFormatJson ?? DEFAULT_OUTPUT_FORMAT,
  );
  const [editPrompt, setEditPrompt] = useState(config.judgePrompt);
  const [editMaxFewShot, setEditMaxFewShot] = useState(
    config.maxFewShotExamples ?? 8,
  );
  const [rightMode, setRightMode] = useState<RightPaneMode>("editor");
  const [saving, setSaving] = useState(false);

  // Sync local state when config changes (e.g., user picks a different evaluator)
  useEffect(() => {
    setEditName(config.name);
    setEditFmId(config.failureModeId);
    setEditModel(config.modelId);
    setEditOutputFormat(config.outputFormatJson ?? DEFAULT_OUTPUT_FORMAT);
    setEditPrompt(config.judgePrompt);
    setEditMaxFewShot(config.maxFewShotExamples ?? 8);
  }, [
    config._id,
    config.name,
    config.failureModeId,
    config.modelId,
    config.outputFormatJson,
    config.judgePrompt,
    config.maxFewShotExamples,
  ]);

  // Load failure modes for this experiment
  const failureModes = useQuery(api.failureModes.crud.byExperiment, {
    experimentId,
  });

  // Load training-split examples for visibility + preview rendering.
  // Pass the live slider value as an override so the display updates
  // immediately without saving.
  const trainingData = useQuery(api.evaluator.crud.trainingExamplesByConfig, {
    configId: config._id,
    overrideMaxFewShot: editMaxFewShot,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfig({
        id: config._id,
        name: editName,
        failureModeId: editFmId,
        judgePrompt: editPrompt,
        outputFormatJson: editOutputFormat,
        maxFewShotExamples: editMaxFewShot,
        modelId: editModel,
      });
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedChanges =
    editName !== config.name ||
    editFmId !== config.failureModeId ||
    editModel !== config.modelId ||
    editOutputFormat !== (config.outputFormatJson ?? DEFAULT_OUTPUT_FORMAT) ||
    editPrompt !== config.judgePrompt ||
    editMaxFewShot !== (config.maxFewShotExamples ?? 8);

  // Build assembled prompt for the preview pane
  const assembledPrompt = useMemo(() => {
    const escapeXml = (text: string) =>
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const parts: string[] = [];

    // System message section
    parts.push("══ SYSTEM ══");
    parts.push("");
    parts.push(editPrompt);
    parts.push("");

    // User message section
    parts.push("══ USER ══");
    parts.push("");

    if (trainingData && trainingData.fewShotExamples.length > 0) {
      parts.push("<examples>");
      trainingData.fewShotExamples.forEach((ex) => {
        const truncatedAnswer =
          ex.answerText.slice(0, 400) +
          (ex.answerText.length > 400 ? "..." : "");
        parts.push("  <example>");
        parts.push(`    <question>${escapeXml(ex.questionText)}</question>`);
        parts.push(
          `    <agent_answer>${escapeXml(truncatedAnswer)}</agent_answer>`,
        );
        const verdict = ex.humanLabel === "pass" ? "Pass" : "Fail";
        parts.push(
          `    <evaluation>{"reasoning": "...", "answer": "${verdict}"}</evaluation>`,
        );
        parts.push("  </example>");
      });
      parts.push("</examples>");
      parts.push("");
    }

    parts.push("<input>");
    parts.push("  <question>{question}</question>");
    parts.push("  <agent_answer>{answer}</agent_answer>");
    parts.push("  <retrieved_context>{context}</retrieved_context>");
    parts.push("</input>");
    parts.push("");
    parts.push("<output_format>");
    parts.push(editOutputFormat);
    parts.push("</output_format>");
    parts.push("");
    parts.push(
      "Evaluate the <input> above and return a JSON object matching <output_format>.",
    );

    return parts.join("\n");
  }, [editPrompt, editOutputFormat, trainingData]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Left pane: form fields */}
      <div className="w-1/2 overflow-y-auto p-6 border-r border-border min-h-0">
        <div className="space-y-5 pb-12">
          {/* Status header */}
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium ${STATUS_LABELS[config.status]?.color}`}
            >
              {STATUS_LABELS[config.status]?.label}
            </span>
            <span className="text-xs text-text-dim">
              Split: {config.splitConfig.trainPct}/{config.splitConfig.devPct}/
              {config.splitConfig.testPct}
              {trainingData && (
                <>
                  {" "}
                  &middot; train:{trainingData.splitSizes.train} dev:
                  {trainingData.splitSizes.dev} test:
                  {trainingData.splitSizes.test}
                </>
              )}
            </span>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Evaluator Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text"
            />
          </div>

          {/* Failure mode selector */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Failure Mode
            </label>
            <select
              value={editFmId}
              onChange={(e) =>
                setEditFmId(e.target.value as Id<"failureModes">)
              }
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text"
            >
              {(failureModes ?? []).map((fm) => (
                <option key={fm._id} value={fm._id}>
                  {fm.name}
                </option>
              ))}
            </select>
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

          {/* Output Format JSON */}
          <div>
            <label className="block text-xs font-medium text-text-dim mb-1.5">
              Output JSON Format
            </label>
            <textarea
              value={editOutputFormat}
              onChange={(e) => setEditOutputFormat(e.target.value)}
              rows={6}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text font-mono resize-y"
            />
            <p className="mt-1 text-xs text-text-dim">
              The JSON shape the judge should return. Injected into the prompt
              as the output schema.
            </p>
          </div>

          {/* Few-shot examples — slider + display */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-text-dim">
                Few-Shot Examples
              </label>
              <span className="text-xs text-text-dim">
                {editMaxFewShot} max
              </span>
            </div>

            {/* Slider */}
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={editMaxFewShot}
              onChange={(e) => setEditMaxFewShot(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="flex justify-between text-[10px] text-text-dim mt-0.5">
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </div>

            <p className="text-xs text-text-dim mt-2 mb-2">
              Stratified sampling balances pass/fail examples from the training
              split.
              {trainingData && (
                <>
                  {" "}
                  Training set has{" "}
                  <span className="text-text">
                    {trainingData.fewShotBreakdown.availablePasses} passes
                  </span>{" "}
                  and{" "}
                  <span className="text-text">
                    {trainingData.fewShotBreakdown.availableFails} fails
                  </span>
                  .
                </>
              )}
            </p>

            {/* Breakdown badge */}
            {trainingData && trainingData.fewShotBreakdown.total > 0 && (
              <div className="text-xs text-text-dim mb-2">
                Selected:{" "}
                <span className="text-accent font-medium">
                  {trainingData.fewShotBreakdown.passes} pass
                </span>{" "}
                +{" "}
                <span className="text-red-400 font-medium">
                  {trainingData.fewShotBreakdown.fails} fail
                </span>{" "}
                ={" "}
                <span className="text-text font-medium">
                  {trainingData.fewShotBreakdown.total} examples
                </span>
              </div>
            )}

            {/* Picked examples list */}
            {!trainingData ? (
              <div className="text-xs text-text-dim">Loading...</div>
            ) : trainingData.fewShotExamples.length === 0 ? (
              <div className="text-xs text-yellow-400">
                {editMaxFewShot === 0
                  ? "Few-shot disabled. Judge will operate zero-shot."
                  : "No training examples available. Annotate more traces first."}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto border border-border rounded-lg bg-bg-elevated p-2">
                {trainingData.fewShotExamples.map((ex) => (
                  <div
                    key={ex.questionId}
                    className="text-xs flex items-start gap-2"
                  >
                    <span
                      className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        ex.humanLabel === "pass"
                          ? "bg-accent/10 text-accent"
                          : "bg-red-400/10 text-red-400"
                      }`}
                    >
                      {ex.humanLabel === "pass" ? "PASS" : "FAIL"}
                    </span>
                    <span className="text-text truncate">
                      {ex.questionText}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={!hasUnsavedChanges || saving}
              className="px-4 py-2 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {hasUnsavedChanges && !saving && (
              <span className="text-xs text-yellow-400">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>

      {/* Right pane: judge prompt editor / preview */}
      <div className="w-1/2 flex flex-col overflow-hidden min-h-0">
        {/* Mode toggle */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elevated">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
            Judge Prompt
          </div>
          <div className="flex bg-bg rounded-md p-0.5">
            <button
              onClick={() => setRightMode("editor")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                rightMode === "editor"
                  ? "bg-bg-elevated text-accent"
                  : "text-text-dim hover:text-text"
              }`}
            >
              Editor
            </button>
            <button
              onClick={() => setRightMode("preview")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                rightMode === "preview"
                  ? "bg-bg-elevated text-accent"
                  : "text-text-dim hover:text-text"
              }`}
            >
              Preview
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {rightMode === "editor" ? (
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              className="flex-1 w-full bg-bg p-4 text-sm text-text font-mono resize-none focus:outline-none min-h-0"
              placeholder="Write the system prompt for your judge..."
            />
          ) : (
            <pre className="flex-1 overflow-auto p-4 text-xs text-text-dim font-mono whitespace-pre-wrap min-h-0">
              {assembledPrompt}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
