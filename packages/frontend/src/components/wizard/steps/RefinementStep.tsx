"use client";

import {
  REFINEMENT_STEP_REGISTRY,
  RERANKER_REGISTRY,
} from "rag-evaluation-system/registry";
import { OptionGroup } from "../shared/OptionGroup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefinementStepProps {
  steps: Array<{ type: string; [key: string]: unknown }>;
  rerankerProvider: string;
  rerankerOptions: Record<string, unknown>;
  onStepsChange: (steps: Array<{ type: string; [key: string]: unknown }>) => void;
  onRerankerChange: (provider: string, options: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRegistryEntry(stepType: string) {
  return REFINEMENT_STEP_REGISTRY.find((e) => e.id === stepType);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RefinementStep({
  steps,
  rerankerProvider,
  rerankerOptions,
  onStepsChange,
  onRerankerChange,
}: RefinementStepProps) {
  const selectedReranker = RERANKER_REGISTRY.find(
    (r) => r.id === rerankerProvider,
  );

  const handleRemoveStep = (index: number) => {
    onStepsChange(steps.filter((_, i) => i !== index));
  };

  const handleAddStep = (type: string) => {
    const entry = findRegistryEntry(type);
    if (!entry) return;
    onStepsChange([...steps, { type, ...entry.defaults }]);
  };

  const handleStepOptionChange = (
    index: number,
    key: string,
    value: unknown,
  ) => {
    const updated = steps.map((step, i) =>
      i === index ? { ...step, [key]: value } : step,
    );
    onStepsChange(updated);
  };

  const handleRerankerSelect = (id: string) => {
    const entry = RERANKER_REGISTRY.find((r) => r.id === id);
    if (entry) {
      onRerankerChange(id, { ...entry.defaults });
    }
  };

  const handleRerankerOptionChange = (key: string, value: unknown) => {
    onRerankerChange(rerankerProvider, { ...rerankerOptions, [key]: value });
  };

  const selectClass =
    "w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 " +
    "focus:outline-none focus:border-accent/50 transition-colors cursor-pointer";

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-medium text-text">Refinement Steps</h3>

      {/* Current steps */}
      {steps.length === 0 ? (
        <p className="text-text-muted text-xs py-4 text-center">
          No refinement steps. Add one below.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const entry = findRegistryEntry(step.type);
            return (
              <li
                key={`${step.type}-${index}`}
                className="border border-border rounded-lg p-3 bg-bg-surface"
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-medium text-text">
                      {index + 1}. {entry?.name ?? step.type}
                    </span>
                    {entry && (
                      <p className="text-xs text-text-muted mt-0.5">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveStep(index)}
                    className="text-text-dim hover:text-error text-sm transition-colors cursor-pointer shrink-0"
                    aria-label={`Remove ${entry?.name ?? step.type} step`}
                  >
                    x
                  </button>
                </div>

                {/* Rerank: inline reranker provider/model config */}
                {step.type === "rerank" && (
                  <div className="mt-3 flex flex-col gap-3 pl-3 border-l border-border">
                    <div>
                      <label className="text-xs font-medium text-text mb-1 block">
                        Reranker Provider
                      </label>
                      <select
                        value={rerankerProvider}
                        onChange={(e) => handleRerankerSelect(e.target.value)}
                        className={selectClass}
                      >
                        {RERANKER_REGISTRY.map((r) => (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={r.status === "coming-soon"}
                          >
                            {r.name}
                            {r.status === "coming-soon"
                              ? " (coming soon)"
                              : ""}
                          </option>
                        ))}
                      </select>
                      {selectedReranker && (
                        <p className="mt-1 text-xs text-text-muted">
                          {selectedReranker.description}
                        </p>
                      )}
                    </div>

                    {selectedReranker &&
                      selectedReranker.options.length > 0 && (
                        <OptionGroup
                          options={selectedReranker.options}
                          values={rerankerOptions}
                          onChange={handleRerankerOptionChange}
                        />
                      )}
                  </div>
                )}

                {/* Step-specific options (e.g. threshold.minScore, rerank.topN) */}
                {entry && entry.options.length > 0 && (
                  <div className="mt-3 pl-3 border-l border-border">
                    <OptionGroup
                      options={entry.options}
                      values={step as Record<string, unknown>}
                      onChange={(key, value) =>
                        handleStepOptionChange(index, key, value)
                      }
                      disabled={entry.status === "coming-soon"}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Add step */}
      <div>
        <label className="text-xs font-medium text-text mb-1 block">
          Add step
        </label>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) {
              handleAddStep(e.target.value);
            }
          }}
          className={selectClass}
        >
          <option value="" disabled>
            Select a step to add...
          </option>
          {REFINEMENT_STEP_REGISTRY.map((entry) => (
            <option
              key={entry.id}
              value={entry.id}
              disabled={entry.status === "coming-soon"}
            >
              {entry.name}
              {entry.status === "coming-soon" ? " (coming soon)" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
