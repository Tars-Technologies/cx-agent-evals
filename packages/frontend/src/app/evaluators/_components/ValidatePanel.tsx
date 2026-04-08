"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id, Doc } from "@convex/_generated/dataModel";

interface ValidatePanelProps {
  config: Doc<"evaluatorConfigs">;
  experimentId: Id<"experiments">;
}

function MetricBadge({ label, value }: { label: string; value: number }) {
  const pct = (value * 100).toFixed(1);
  const color =
    value >= 0.9
      ? "text-accent"
      : value >= 0.8
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 flex items-center gap-3">
      <div className={`text-lg font-bold ${color}`}>{pct}%</div>
      <div className="text-xs text-text-dim">{label}</div>
    </div>
  );
}

export function ValidatePanel({ config, experimentId }: ValidatePanelProps) {
  const startValidation = useMutation(api.evaluator.crud.startValidation);
  const [runningType, setRunningType] = useState<"dev" | "test" | null>(null);
  const [activeRunId, setActiveRunId] = useState<Id<"evaluatorRuns"> | null>(
    null,
  );
  const [filter, setFilter] = useState<
    "all" | "disagree" | "false_pass" | "false_fail"
  >("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Get runs for this config
  const runs = useQuery(api.evaluator.crud.runsByConfig, {
    evaluatorConfigId: config._id,
  });

  // Get the latest dev and test runs
  const latestDevRun = runs?.find(
    (r) => r.runType === "dev" && r.status === "completed",
  );
  const latestTestRun = runs?.find(
    (r) => r.runType === "test" && r.status === "completed",
  );

  // Check for in-progress runs
  const runningRun = runs?.find(
    (r) => r.status === "pending" || r.status === "running",
  );

  // Get results for the active run (default to latest dev)
  const displayRunId = activeRunId ?? latestDevRun?._id;
  const results = useQuery(
    api.evaluator.crud.resultsByRun,
    displayRunId ? { runId: displayRunId } : "skip",
  );

  // Load questions for display
  const experiment = useQuery(api.experiments.orchestration.get, {
    id: experimentId,
  });
  const questions = useQuery(
    api.crud.questions.byDataset,
    experiment?.datasetId ? { datasetId: experiment.datasetId } : "skip",
  );
  const questionMap = new Map(
    (questions ?? []).map((q) => [q._id, q]),
  );

  const handleRunValidation = async (type: "dev" | "test") => {
    setRunningType(type);
    try {
      const runId = await startValidation({
        evaluatorConfigId: config._id,
        runType: type,
      });
      setActiveRunId(runId);
    } finally {
      setRunningType(null);
    }
  };

  // Filter results
  const filteredResults = (results ?? []).filter((r) => {
    if (filter === "all") return true;
    if (filter === "disagree") return r.agreesWithHuman === false;
    if (filter === "false_pass")
      return r.judgeVerdict === "pass" && r.humanLabel === "fail";
    if (filter === "false_fail")
      return r.judgeVerdict === "fail" && r.humanLabel === "pass";
    return true;
  });

  const displayRun = displayRunId
    ? runs?.find((r) => r._id === displayRunId)
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 min-h-0">
      {/* Actions bar */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => handleRunValidation("dev")}
          disabled={!!runningRun || runningType === "dev"}
          className="px-4 py-2 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
        >
          {runningRun?.runType === "dev" ? "Running Dev..." : "Run on Dev Set"}
        </button>
        <button
          onClick={() => handleRunValidation("test")}
          disabled={!!runningRun || !config.devMetrics || runningType === "test"}
          className="px-4 py-2 bg-bg-elevated border border-border text-text rounded-lg hover:bg-bg-hover transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed enabled:cursor-pointer"
        >
          {runningRun?.runType === "test"
            ? "Running Test..."
            : "Run on Test Set"}
        </button>

        {!config.devMetrics && (
          <span className="text-xs text-text-dim">
            Run on dev set first to see metrics
          </span>
        )}
      </div>

      {/* Progress bar for running */}
      {runningRun && (
        <div className="mb-4 bg-bg-elevated border border-border rounded-lg p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-text">
              Running on {runningRun.runType} set...
            </span>
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

      {/* Metrics display */}
      {(config.devMetrics || config.testMetrics) && (
        <div className="mb-4">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wide mb-2">
            {config.testMetrics ? "Test Set Metrics" : "Dev Set Metrics"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricBadge
              label="TPR (True Positive Rate)"
              value={
                (config.testMetrics ?? config.devMetrics)!.tpr
              }
            />
            <MetricBadge
              label="TNR (True Negative Rate)"
              value={
                (config.testMetrics ?? config.devMetrics)!.tnr
              }
            />
            <MetricBadge
              label="Accuracy"
              value={
                (config.testMetrics ?? config.devMetrics)!.accuracy
              }
            />
          </div>
        </div>
      )}

      {/* Results table */}
      {results && results.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-text-dim">Filter:</span>
            {(
              [
                { key: "all", label: "All" },
                { key: "disagree", label: "Disagreements" },
                { key: "false_pass", label: "False Passes" },
                { key: "false_fail", label: "False Fails" },
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
                {f.key === "disagree" && (
                  <span className="ml-1 text-text-dim">
                    ({results.filter((r) => !r.agreesWithHuman).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto border border-border rounded-lg min-h-0">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated sticky top-0">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-medium text-text-dim">
                    Question
                  </th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-24">
                    Human
                  </th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-24">
                    Judge
                  </th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-20">
                    Agree?
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r) => {
                  const q = questionMap.get(r.questionId);
                  const isFP =
                    r.judgeVerdict === "pass" && r.humanLabel === "fail";
                  const isFN =
                    r.judgeVerdict === "fail" && r.humanLabel === "pass";
                  const isExpanded = expandedRow === r._id;

                  const rowBg = isFP
                    ? "bg-red-500/5"
                    : isFN
                      ? "bg-orange-500/5"
                      : "";

                  return (
                    <tr
                      key={r._id}
                      onClick={() =>
                        setExpandedRow(isExpanded ? null : r._id)
                      }
                      className={`border-b border-border cursor-pointer hover:bg-bg-hover transition-colors ${rowBg}`}
                    >
                      <td className="px-3 py-2">
                        <div className="text-text truncate max-w-md">
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
                          className={`text-xs font-medium ${
                            r.humanLabel === "pass"
                              ? "text-accent"
                              : "text-red-400"
                          }`}
                        >
                          {r.humanLabel === "pass" ? "Pass" : "Fail"}
                        </span>
                      </td>
                      <td className="text-center px-3 py-2">
                        <span
                          className={`text-xs font-medium ${
                            r.judgeVerdict === "pass"
                              ? "text-accent"
                              : "text-red-400"
                          }`}
                        >
                          {r.judgeVerdict === "pass" ? "Pass" : "Fail"}
                        </span>
                      </td>
                      <td className="text-center px-3 py-2">
                        {r.agreesWithHuman ? (
                          <span className="text-accent">&#10003;</span>
                        ) : (
                          <span className="text-red-400">&#10007;</span>
                        )}
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
      {!results?.length && !runningRun && (
        <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
          {config.devMetrics
            ? "Select a run to view results"
            : "Run validation on the dev set to see results"}
        </div>
      )}
    </div>
  );
}
