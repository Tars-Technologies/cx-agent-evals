"use client";

import { useState } from "react";
import { ScenarioFields, type Scenario } from "@/components/ScenarioFields";
import { SourceTranscriptPanel } from "@/components/livechat/SourceTranscriptPanel";
import type { Id } from "@convex/_generated/dataModel";

export function ScenarioDetail({
  scenario,
  onEdit,
}: {
  scenario: Scenario;
  onEdit?: () => void;
}) {
  const [showSource, setShowSource] = useState(false);

  // Reset toggle when the displayed scenario changes
  // React-canonical pattern: react.dev/learn/you-might-not-need-an-effect#resetting-state-when-a-prop-changes
  const [lastScenarioId, setLastScenarioId] = useState(scenario._id);
  if (scenario._id !== lastScenarioId) {
    setLastScenarioId(scenario._id);
    setShowSource(false);
  }

  const hasSource = !!scenario.sourceTranscriptId;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text truncate">{scenario.topic}</h2>
          <p className="text-xs text-text-dim mt-0.5 truncate">{scenario.intent}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasSource && (
            <button
              onClick={() => setShowSource((v) => !v)}
              className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
            >
              {showSource ? "Hide source" : "View source transcript"}
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Body — split when showSource is on */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <ScenarioFields scenario={scenario} />
        </div>
        {showSource && hasSource && (
          <div className="w-1/2 min-w-0 border-l border-border overflow-hidden">
            <SourceTranscriptPanel
              sourceTranscriptId={scenario.sourceTranscriptId as Id<"livechatConversations">}
            />
          </div>
        )}
      </div>
    </div>
  );
}
