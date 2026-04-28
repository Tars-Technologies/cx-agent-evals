"use client";

import { ScenarioFields, type Scenario } from "@/components/ScenarioFields";

export function ScenarioDetail({
  scenario,
  onEdit,
}: {
  scenario: Scenario;
  onEdit?: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated/50 sticky top-0 z-10">
        <div>
          <h2 className="text-sm font-medium text-text">{scenario.topic}</h2>
          <p className="text-xs text-text-dim mt-0.5">{scenario.intent}</p>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <ScenarioFields scenario={scenario} />
    </div>
  );
}
