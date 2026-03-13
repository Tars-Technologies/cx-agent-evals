"use client";

import { useState, useMemo } from "react";
import {
  PRESET_REGISTRY,
} from "rag-evaluation-system/registry";
import type { PresetEntry } from "rag-evaluation-system/registry";
import { StrategyCard } from "../shared/StrategyCard";
import { ComplexityBadge } from "../shared/ComplexityBadge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChoosePresetStepProps {
  selectedPresetId: string | null;
  onSelectPreset: (id: string | null) => void;
}

type Complexity = PresetEntry["complexity"];

const ALL_COMPLEXITIES: readonly Complexity[] = [
  "basic",
  "intermediate",
  "advanced",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a short stage breadcrumb like "plain > identity > hybrid > rerank" */
function stageBreadcrumb(stages: PresetEntry["stages"]): string {
  const parts: string[] = [];

  // Extract the first word (strategy name) from each stage summary
  const indexName = stages.index.split(" ")[0].toLowerCase();
  const queryName = stages.query.split(" ")[0].toLowerCase();
  const searchName = stages.search.split(" ")[0].toLowerCase();
  const refineName =
    stages.refinement.toLowerCase() === "none"
      ? null
      : stages.refinement.split(" ")[0].toLowerCase();

  parts.push(indexName, queryName, searchName);
  if (refineName) {
    parts.push(refineName);
  }

  return parts.join(" > ");
}

/** Requirement pills for a preset */
function RequirementPills({ preset }: { preset: PresetEntry }) {
  return (
    <>
      {preset.requiresLLM && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim">
          LLM
        </span>
      )}
      {preset.requiresReranker && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim">
          Reranker
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChoosePresetStep({
  selectedPresetId,
  onSelectPreset,
}: ChoosePresetStepProps) {
  const [searchText, setSearchText] = useState("");
  const [enabledComplexities, setEnabledComplexities] = useState<
    Set<Complexity>
  >(new Set(ALL_COMPLEXITIES));

  const toggleComplexity = (c: Complexity) => {
    setEnabledComplexities((prev) => {
      const next = new Set(prev);
      if (next.has(c)) {
        next.delete(c);
      } else {
        next.add(c);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const lowerSearch = searchText.toLowerCase().trim();

    return PRESET_REGISTRY.filter((p) => {
      if (!enabledComplexities.has(p.complexity)) return false;
      if (lowerSearch === "") return true;
      return (
        p.name.toLowerCase().includes(lowerSearch) ||
        p.description.toLowerCase().includes(lowerSearch)
      );
    });
  }, [searchText, enabledComplexities]);

  return (
    <div className="flex flex-col gap-5">
      {/* Start from scratch — now at the top */}
      <button
        type="button"
        onClick={() => onSelectPreset(null)}
        className={`
          w-full text-center text-sm py-2 rounded-lg border transition-colors cursor-pointer
          ${selectedPresetId === null
            ? "border-accent text-accent bg-accent-dim/10"
            : "border-border text-text-muted bg-bg-surface hover:bg-bg-hover hover:border-border-bright"
          }
        `}
      >
        Start from scratch
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-text-dim text-xs">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Complexity checkboxes */}
        <div className="flex items-center gap-4">
          {ALL_COMPLEXITIES.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enabledComplexities.has(c)}
                onChange={() => toggleComplexity(c)}
                className="w-3.5 h-3.5 rounded border-border bg-bg-surface text-accent focus:ring-accent/50"
              />
              <ComplexityBadge complexity={c} />
            </label>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search presets..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="
            w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
            placeholder:text-text-dim
            focus:outline-none focus:border-accent/50 transition-colors
          "
        />
      </div>

      {/* Preset grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((preset) => (
          <div key={preset.id} className="flex flex-col">
            <StrategyCard
              id={preset.id}
              name={preset.name}
              description={preset.description}
              status={preset.status}
              selected={selectedPresetId === preset.id}
              onSelect={(id) => onSelectPreset(id)}
              badge={<ComplexityBadge complexity={preset.complexity} />}
              tags={preset.tags}
            />
            {/* Extra metadata below the card */}
            <div className="flex items-center gap-2 mt-1 px-1">
              <RequirementPills preset={preset} />
              <span className="text-text-dim text-xs truncate">
                {stageBreadcrumb(preset.stages)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-text-muted text-xs text-center py-4">
          No presets match the current filters.
        </p>
      )}
    </div>
  );
}
