"use client";

import { Id } from "@convex/_generated/dataModel";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "text-text-dim" },
  validating: { label: "Awaiting Test", color: "text-yellow-400" },
  validated: { label: "Validated", color: "text-blue-400" },
  ready: { label: "Ready", color: "text-accent" },
};

interface ConfigWithMeta {
  _id: Id<"evaluatorConfigs">;
  name: string;
  status: string;
  experimentName: string;
  failureModeName: string;
  failureModeDescription: string;
  devMetrics?: { tpr: number; tnr: number } | null;
  testMetrics?: { tpr: number; tnr: number } | null;
}

interface EvaluatorSidebarProps {
  configs: ConfigWithMeta[];
  selectedConfigId: Id<"evaluatorConfigs"> | null;
  onSelectConfig: (id: Id<"evaluatorConfigs">) => void;
  onNewEvaluator: () => void;
  loading: boolean;
}

export function EvaluatorSidebar({
  configs,
  selectedConfigId,
  onSelectConfig,
  onNewEvaluator,
  loading,
}: EvaluatorSidebarProps) {
  // Group by experiment name
  const byExperiment = new Map<string, ConfigWithMeta[]>();
  for (const c of configs) {
    const list = byExperiment.get(c.experimentName) ?? [];
    list.push(c);
    byExperiment.set(c.experimentName, list);
  }

  return (
    <div className="w-72 bg-bg border-r border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
          Evaluators
        </div>
        <button
          onClick={onNewEvaluator}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          + New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-text-dim text-xs">Loading...</div>
        ) : configs.length === 0 ? (
          <div className="p-4 text-text-dim text-xs">
            No evaluators yet. Click "+ New" to create one.
          </div>
        ) : (
          [...byExperiment.entries()].map(([expName, expConfigs]) => (
            <div key={expName}>
              <div className="px-3 py-2 text-xs font-medium text-text-dim bg-bg-elevated/50 border-b border-border truncate">
                {expName}
              </div>
              {expConfigs.map((c) => {
                const isSelected = c._id === selectedConfigId;
                const status = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft;
                const metrics = c.testMetrics ?? c.devMetrics;

                return (
                  <button
                    key={c._id}
                    onClick={() => onSelectConfig(c._id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-accent/10 border-l-2 border-l-accent"
                        : "hover:bg-bg-hover"
                    }`}
                  >
                    <div className="text-sm font-medium text-text truncate">
                      {c.failureModeName}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${status.color}`}>
                        {status.label}
                      </span>
                      {metrics && (
                        <span className="text-xs text-text-dim">
                          {(metrics.tpr * 100).toFixed(0)}% / {(metrics.tnr * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
