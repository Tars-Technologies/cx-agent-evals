"use client";

import { SEARCH_STRATEGY_REGISTRY } from "rag-evaluation-system/registry";
import { StrategyCard } from "../shared/StrategyCard";
import { OptionGroup } from "../shared/OptionGroup";
import { IndexSearchNote } from "@/components/tabs/QuerySearchTab";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchStepProps {
  searchStrategy: string;
  searchOptions: Record<string, unknown>;
  k: number;
  onSearchChange: (strategy: string, options: Record<string, unknown>) => void;
  onKChange: (k: number) => void;
  indexStrategy?: string;
  indexConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SearchStep({
  searchStrategy,
  searchOptions,
  k,
  onSearchChange,
  onKChange,
  indexStrategy,
  indexConfig,
}: SearchStepProps) {
  const selectedEntry = SEARCH_STRATEGY_REGISTRY.find(
    (e) => e.id === searchStrategy,
  );

  const handleStrategySelect = (id: string) => {
    const entry = SEARCH_STRATEGY_REGISTRY.find((e) => e.id === id);
    if (entry) {
      onSearchChange(id, { ...entry.defaults });
    }
  };

  const handleOptionChange = (key: string, value: unknown) => {
    onSearchChange(searchStrategy, { ...searchOptions, [key]: value });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Strategy cards */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Search Strategy</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SEARCH_STRATEGY_REGISTRY.map((entry) => (
            <StrategyCard
              key={entry.id}
              id={entry.id}
              name={entry.name}
              description={entry.description}
              status={entry.status}
              selected={searchStrategy === entry.id}
              onSelect={handleStrategySelect}
              tags={entry.tags}
            />
          ))}
        </div>
      </section>

      {/* Index→search interaction note */}
      {indexStrategy && indexStrategy !== "plain" && (
        <IndexSearchNote indexStrategy={indexStrategy} indexConfig={indexConfig ?? {}} />
      )}

      {/* Strategy options */}
      {selectedEntry && selectedEntry.options.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-text mb-3">
            {selectedEntry.name} Options
          </h3>
          <OptionGroup
            options={selectedEntry.options}
            values={searchOptions}
            onChange={handleOptionChange}
          />
        </section>
      )}

      {/* Top K */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Top K</h3>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-xs font-medium text-text">
              Results to retrieve
            </label>
          </div>
          <input
            type="number"
            value={k}
            min={1}
            max={100}
            step={1}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) {
                onKChange(val);
              }
            }}
            className="
              w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
              focus:outline-none focus:border-accent/50 transition-colors
            "
          />
          <p className="mt-1 text-xs text-text-muted">
            Number of top results to return from search (1-100).
          </p>
        </div>
      </section>
    </div>
  );
}
