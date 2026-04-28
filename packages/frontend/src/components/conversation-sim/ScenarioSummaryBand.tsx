"use client";

import { useState } from "react";
import { ScenarioFields, Chip, type Scenario } from "@/components/ScenarioFields";

export function ScenarioSummaryBand({
  scenario,
}: {
  scenario: Scenario | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lastScenarioId, setLastScenarioId] = useState(scenario?._id);

  // Collapse when the linked scenario changes (reset-on-prop-change pattern,
  // see https://react.dev/learn/you-might-not-need-an-effect#resetting-state-when-a-prop-changes).
  if (scenario?._id !== lastScenarioId) {
    setLastScenarioId(scenario?._id);
    setExpanded(false);
  }

  // Loading
  if (scenario === undefined) {
    return (
      <div className="px-4 py-2 border-b border-border bg-bg-elevated/30">
        <div className="h-4 bg-bg-elevated/60 rounded animate-pulse w-1/3" />
      </div>
    );
  }

  // Deleted / not found
  if (scenario === null) {
    return null;
  }

  return (
    <div className="border-b border-border bg-bg-elevated/30">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-start justify-between gap-3 hover:bg-bg-elevated/50 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text font-medium truncate">{scenario.topic}</span>
            <Chip color="gray">{scenario.persona.type}</Chip>
            <Chip color={scenario.complexity === "high" ? "red" : scenario.complexity === "medium" ? "yellow" : "green"}>
              {scenario.complexity}
            </Chip>
          </div>
          <p className="text-[11px] text-text-dim mt-0.5 truncate">{scenario.intent}</p>
        </div>
        <span className="text-text-dim text-xs flex-shrink-0 mt-0.5">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <ScenarioFields scenario={scenario} />
        </div>
      )}
    </div>
  );
}
