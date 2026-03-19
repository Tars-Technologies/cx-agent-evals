"use client";

import { QUERY_STRATEGY_REGISTRY } from "rag-evaluation-system/registry";
import { StrategyCard } from "../shared/StrategyCard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryStepProps {
  queryStrategy: string;
  onQueryStrategyChange: (strategy: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QueryStep({
  queryStrategy,
  onQueryStrategyChange,
}: QueryStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-text">Query Strategy</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {QUERY_STRATEGY_REGISTRY.map((entry) => (
          <StrategyCard
            key={entry.id}
            id={entry.id}
            name={entry.name}
            description={entry.description}
            status={entry.status}
            selected={queryStrategy === entry.id}
            onSelect={onQueryStrategyChange}
            tags={entry.tags}
          />
        ))}
      </div>
    </div>
  );
}
