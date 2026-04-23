"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id, Doc } from "@convex/_generated/dataModel";

interface RunPanelProps {
  config: Doc<"evaluatorConfigs">;
  experimentId: Id<"experiments">;
  experiment: Doc<"experiments">;
}

export function RunPanel({ config, experimentId, experiment }: RunPanelProps) {
  const startFullRun = useMutation(api.evaluator.crud.startFullRun);
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<Id<"evaluatorRuns"> | null>(
    null,
  );
  const [filter, setFilter] = useState<"all" | "pass" | "fail">("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Get available experiments to run on (same KB)
  const experiments = useQuery(
    api.experiments.orchestration.byKb,
    experiment.kbId ? { kbId: experiment.kbId } : "skip",
  );
  const completedExperiments = (experiments ?? []).filter(
    (e) =>
      e.experimentType === "agent" &&
      (e.status === "completed" || e.status === "completed_with_errors"),
  );

  const [targetExpId, setTargetExpId] = useState<Id<"experiments"> | "">("");

  // Get runs
  const runs = useQuery(api.evaluator.crud.runsByConfig, {
    evaluatorConfigId: config._id,
  });
  const fullRuns = (runs ?? []).filter((r) => r.runType === "full");
  const runningRun = fullRuns.find(
    (r) => r.status === "pending" || r.status === "running",
  );

  // Display run: active selection or latest completed full run
  const displayRunId =
    activeRunId ?? fullRuns.find((r) => r.status === "completed")?._id;
  const displayRun = displayRunId
    ? fullRuns.find((r) => r._id === displayRunId)
    : null;

  const results = useQuery(
    api.evaluator.crud.resultsByRun,
    displayRunId ? { runId: displayRunId } : "skip",
  );

  // Questions for display
  const targetExp = useQuery(
    api.experiments.orchestration.get,
    displayRun?.targetExperimentId
      ? { id: displayRun.targetExperimentId }
      : "skip",
  );
  const targetQuestions = useQuery(
    api.crud.questions.byDataset,
    targetExp?.datasetId ? { datasetId: targetExp.datasetId } : "skip",
  );
  const questionMap = new Map(
    (targetQuestions ?? []).map((q) => [q._id, q]),
  );

  const handleRun = async () => {
    if (!targetExpId) return;
    setRunning(true);
    try {
      const runId = await startFullRun({
        evaluatorConfigId: config._id,
        targetExperimentId: targetExpId as Id<"experiments">,
      });
      setActiveRunId(runId);
    } finally {
      setRunning(false);
    }
  };

  const filteredResults = (results ?? []).filter((r) => {
    if (filter === "all") return true;
    return r.judgeVerdict === filter;
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 min-h-0">
      {/* Test metrics banner */}
      {config.testMetrics && (
        <div className="mb-6 bg-bg-elevated border border-border rounded-lg p-4">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wide mb-2">
            Judge Performance (from Test Set)
          </div>
          <div className="flex items-center gap-6">
            <div>
              <span className="text-lg font-bold text-accent">
                {(config.testMetrics.tpr * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-text-dim ml-1">TPR</span>
            </div>
            <div>
              <span className="text-lg font-bold text-accent">
                {(config.testMetrics.tnr * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-text-dim ml-1">TNR</span>
            </div>
            <div
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                config.status === "ready"
                  ? "bg-accent/10 text-accent"
                  : "bg-yellow-400/10 text-yellow-400"
              }`}
            >
              {config.status === "ready"
                ? "Ready to run"
                : "TPR/TNR below 80% threshold"}
            </div>
          </div>
        </div>
      )}

      {/* Run controls */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={targetExpId}
          onChange={(e) => setTargetExpId(e.target.value as any)}
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text min-w-[300px]"
        >
          <option value="">Select experiment to evaluate...</option>
          {completedExperiments.map((e) => (
            <option key={e._id} value={e._id}>
              {e.name} ({e.totalQuestions} questions)
            </option>
          ))}
        </select>
        <button
          onClick={handleRun}
          disabled={!targetExpId || !!runningRun || running}
          className="px-4 py-2 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
        >
          {runningRun ? "Running..." : "Run Evaluator"}
        </button>
      </div>

      {/* Progress */}
      {runningRun && (
        <div className="mb-6 bg-bg-elevated border border-border rounded-lg p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-text">Evaluating traces...</span>
            <span className="text-text-dim">
              {runningRun.processedTraces}/{runningRun.totalTraces || "?"}
            </span>
          </div>
          {runningRun.totalTraces > 0 && (
            <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{
                  width: `${(runningRun.processedTraces / runningRun.totalTraces) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Corrected pass rate display */}
      {displayRun?.status === "completed" && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          {/* Corrected rate */}
          <div className="bg-bg-elevated border border-border rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-accent">
              {displayRun.correctedPassRate !== undefined
                ? `${(displayRun.correctedPassRate * 100).toFixed(1)}%`
                : "N/A"}
            </div>
            <div className="text-xs text-text-dim mt-1">
              Corrected Pass Rate (&theta;)
            </div>
            {displayRun.confidenceInterval && (
              <div className="text-xs text-text-dim mt-0.5">
                95% CI: [{(displayRun.confidenceInterval.lower * 100).toFixed(1)}
                %, {(displayRun.confidenceInterval.upper * 100).toFixed(1)}%]
              </div>
            )}
          </div>

          {/* Raw rate */}
          <div className="bg-bg-elevated border border-border rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-text-dim">
              {displayRun.rawPassRate !== undefined
                ? `${(displayRun.rawPassRate * 100).toFixed(1)}%`
                : "N/A"}
            </div>
            <div className="text-xs text-text-dim mt-1">
              Raw Pass Rate (uncorrected)
            </div>
          </div>

          {/* Traces processed */}
          <div className="bg-bg-elevated border border-border rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-text">
              {displayRun.processedTraces - displayRun.failedTraces}
            </div>
            <div className="text-xs text-text-dim mt-1">
              Traces Evaluated
              {displayRun.failedTraces > 0 && (
                <span className="text-red-400 ml-1">
                  ({displayRun.failedTraces} failed)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results table */}
      {results && results.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-text-dim">Filter:</span>
            {(
              [
                { key: "all", label: "All" },
                { key: "pass", label: "Pass" },
                { key: "fail", label: "Fail" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                  filter === f.key
                    ? "bg-accent/10 text-accent"
                    : "text-text-dim hover:text-text hover:bg-bg-hover"
                }`}
              >
                {f.label}
                <span className="ml-1 text-text-dim">
                  (
                  {f.key === "all"
                    ? results.length
                    : results.filter((r) => r.judgeVerdict === f.key).length}
                  )
                </span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated sticky top-0">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-medium text-text-dim">
                    Question
                  </th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-24">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r) => {
                  const q = questionMap.get(r.questionId);
                  const isExpanded = expandedRow === r._id;

                  return (
                    <tr
                      key={r._id}
                      onClick={() =>
                        setExpandedRow(isExpanded ? null : r._id)
                      }
                      className="border-b border-border cursor-pointer hover:bg-bg-hover transition-colors"
                    >
                      <td className="px-3 py-2">
                        <div className="text-text truncate max-w-lg">
                          {q?.queryText ?? "Unknown"}
                        </div>
                        {isExpanded && (
                          <div className="mt-2 p-2 bg-bg-elevated rounded text-xs text-text-dim">
                            <div className="font-medium text-text mb-1">
                              Judge Reasoning:
                            </div>
                            {r.judgeReasoning}
                          </div>
                        )}
                      </td>
                      <td className="text-center px-3 py-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            r.judgeVerdict === "pass"
                              ? "bg-accent/10 text-accent"
                              : "bg-red-400/10 text-red-400"
                          }`}
                        >
                          {r.judgeVerdict === "pass" ? "Pass" : "Fail"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!results?.length && !runningRun && !displayRun && (
        <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
          Select an experiment and run the evaluator to see results
        </div>
      )}
    </div>
  );
}
