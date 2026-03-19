"use client";

import {
  INDEX_STRATEGY_REGISTRY,
  QUERY_STRATEGY_REGISTRY,
  SEARCH_STRATEGY_REGISTRY,
  REFINEMENT_STEP_REGISTRY,
  CHUNKER_REGISTRY,
  EMBEDDER_REGISTRY,
  RERANKER_REGISTRY,
  PRESET_REGISTRY,
} from "rag-evaluation-system/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewStepProps {
  config: {
    name: string;
    indexStrategy: string;
    chunkerType: string;
    chunkerOptions: Record<string, unknown>;
    embedderProvider: string;
    embedderOptions: Record<string, unknown>;
    queryStrategy: string;
    searchStrategy: string;
    searchOptions: Record<string, unknown>;
    k: number;
    refinementSteps: Array<{ type: string; [key: string]: unknown }>;
    rerankerProvider: string;
    rerankerOptions: Record<string, unknown>;
  };
  basePreset: string | null;
  onNameChange: (name: string) => void;
  onEditStep: (stepIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupName(
  registry: readonly { id: string; name: string }[],
  id: string,
): string {
  return registry.find((e) => e.id === id)?.name ?? id;
}

/** Format an options record as "key: value" lines, skipping empties */
function formatOptions(opts: Record<string, unknown>): string[] {
  return Object.entries(opts)
    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${String(v)}`);
}

function SectionHeader({
  title,
  stepIndex,
  onEdit,
}: {
  title: string;
  stepIndex: number;
  onEdit: (stepIndex: number) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-text uppercase tracking-wider">
        {title}
      </h4>
      <button
        type="button"
        onClick={() => onEdit(stepIndex)}
        className="text-xs text-accent hover:text-accent-bright transition-colors cursor-pointer"
      >
        Edit
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-text-dim w-28 shrink-0">{label}</span>
      <span className="text-xs text-text">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewStep({
  config,
  basePreset,
  onNameChange,
  onEditStep,
}: ReviewStepProps) {
  const presetName = basePreset
    ? PRESET_REGISTRY.find((p) => p.id === basePreset)?.name ?? basePreset
    : null;

  const chunkerOpts = formatOptions(config.chunkerOptions);
  const embedderOpts = formatOptions(config.embedderOptions);
  const searchOpts = formatOptions(config.searchOptions);
  const rerankerOpts = formatOptions(config.rerankerOptions);

  return (
    <div className="flex flex-col gap-5">
      {/* Name input */}
      <div>
        <label className="text-xs font-medium text-text mb-1 block">
          Config Name
        </label>
        <input
          type="text"
          value={config.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="my-retriever-config"
          className="
            w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
            placeholder:text-text-dim
            focus:outline-none focus:border-accent/50 transition-colors
          "
        />
        {presetName && (
          <p className="mt-1 text-xs text-text-muted">
            Based on: {presetName}
          </p>
        )}
      </div>

      {/* ---- Index Section ---- */}
      <section className="border border-border rounded-lg p-3 bg-bg-surface">
        <SectionHeader title="Index" stepIndex={0} onEdit={onEditStep} />
        <div className="flex flex-col gap-1.5">
          <SummaryRow
            label="Strategy"
            value={lookupName(INDEX_STRATEGY_REGISTRY, config.indexStrategy)}
          />
          <SummaryRow
            label="Chunker"
            value={lookupName(CHUNKER_REGISTRY, config.chunkerType)}
          />
          {chunkerOpts.map((line) => (
            <SummaryRow key={line} label="" value={line} />
          ))}
          <SummaryRow
            label="Embedder"
            value={lookupName(EMBEDDER_REGISTRY, config.embedderProvider)}
          />
          {embedderOpts.map((line) => (
            <SummaryRow key={line} label="" value={line} />
          ))}
        </div>
      </section>

      {/* ---- Query Section ---- */}
      <section className="border border-border rounded-lg p-3 bg-bg-surface">
        <SectionHeader title="Query" stepIndex={1} onEdit={onEditStep} />
        <SummaryRow
          label="Strategy"
          value={lookupName(QUERY_STRATEGY_REGISTRY, config.queryStrategy)}
        />
      </section>

      {/* ---- Search Section ---- */}
      <section className="border border-border rounded-lg p-3 bg-bg-surface">
        <SectionHeader title="Search" stepIndex={2} onEdit={onEditStep} />
        <div className="flex flex-col gap-1.5">
          <SummaryRow
            label="Strategy"
            value={lookupName(SEARCH_STRATEGY_REGISTRY, config.searchStrategy)}
          />
          {searchOpts.map((line) => (
            <SummaryRow key={line} label="" value={line} />
          ))}
          <SummaryRow label="Top K" value={String(config.k)} />
        </div>
      </section>

      {/* ---- Refinement Section ---- */}
      <section className="border border-border rounded-lg p-3 bg-bg-surface">
        <SectionHeader title="Refinement" stepIndex={3} onEdit={onEditStep} />
        {config.refinementSteps.length === 0 ? (
          <p className="text-xs text-text-muted">None</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {config.refinementSteps.map((step, i) => (
              <SummaryRow
                key={`${step.type}-${i}`}
                label={`Step ${i + 1}`}
                value={lookupName(REFINEMENT_STEP_REGISTRY, step.type)}
              />
            ))}
            {config.refinementSteps.some((s) => s.type === "rerank") && (
              <>
                <SummaryRow
                  label="Reranker"
                  value={lookupName(RERANKER_REGISTRY, config.rerankerProvider)}
                />
                {rerankerOpts.map((line) => (
                  <SummaryRow key={line} label="" value={line} />
                ))}
              </>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
