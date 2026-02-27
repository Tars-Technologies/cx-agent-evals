"use client";

import type {
  PipelineConfig,
  SearchConfig,
  RefinementStepConfig,
} from "@/lib/pipeline-types";
import { resolveConfig } from "@/lib/pipeline-types";

interface PipelineConfigSummaryProps {
  config: PipelineConfig;
  configName: string;
  isModified: boolean;
  onEdit: () => void;
}

function formatEmbedder(model: string): string {
  return model.replace("text-embedding-", "");
}

function formatSearch(search: SearchConfig, k: number): string {
  switch (search.strategy) {
    case "dense":
      return `dense · k=${k}`;
    case "bm25":
      return `bm25 · k=${k}`;
    case "hybrid": {
      const dw = search.denseWeight ?? 0.7;
      const sw = search.sparseWeight ?? 0.3;
      return `hybrid(${dw}/${sw}) · k=${k}`;
    }
  }
}

function formatRefinement(steps: readonly RefinementStepConfig[]): string {
  if (steps.length === 0) return "none";
  return steps.map((s) => s.type).join(" → ");
}

export function PipelineConfigSummary({
  config,
  configName,
  isModified,
  onEdit,
}: PipelineConfigSummaryProps) {
  const resolved = resolveConfig(config);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        {isModified && (
          <span className="text-[11px] text-text-muted truncate">
            {configName}
          </span>
        )}
        <button
          onClick={onEdit}
          className="text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer uppercase tracking-wider font-semibold flex-shrink-0 ml-2"
        >
          Edit
        </button>
      </div>

      <div className="space-y-1 text-[11px]">
        <div className="flex gap-2">
          <span className="text-text-dim w-14 flex-shrink-0">Index</span>
          <span className="text-text-muted truncate">
            recursive({resolved.index.chunkSize}/{resolved.index.chunkOverlap}) ·{" "}
            {formatEmbedder(resolved.index.embeddingModel)} · convex
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-text-dim w-14 flex-shrink-0">Query</span>
          <span className="text-text-muted">{resolved.query.strategy}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-text-dim w-14 flex-shrink-0">Search</span>
          <span className="text-text-muted">
            {formatSearch(resolved.search, resolved.k)}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-text-dim w-14 flex-shrink-0">Refine</span>
          <span className="text-text-muted">
            {formatRefinement(resolved.refinement)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ConfigurePipelineButtonProps {
  onClick: () => void;
}

export function ConfigurePipelineButton({
  onClick,
}: ConfigurePipelineButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full py-2.5 rounded border border-dashed border-accent/30 text-xs text-accent
                 hover:bg-accent/5 hover:border-accent/50 transition-all cursor-pointer"
    >
      Configure Pipeline
    </button>
  );
}
