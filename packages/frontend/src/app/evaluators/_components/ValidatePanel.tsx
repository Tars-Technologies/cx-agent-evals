"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id, Doc } from "@convex/_generated/dataModel";

interface ValidatePanelProps {
  config: Doc<"evaluatorConfigs">;
  experimentId: Id<"experiments">;
}

function MetricBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const pct = (value * 100).toFixed(1);
  const color =
    value >= 0.9
      ? "text-accent"
      : value >= 0.8
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div className="flex items-center gap-2">
      <div className={`text-base font-bold ${color}`}>{pct}%</div>
      <div className="text-[10px] text-text-dim">{label}</div>
    </div>
  );
}

function MetricCard({
  title,
  metrics,
  isActive,
  onClick,
  isEmpty,
}: {
  title: string;
  metrics?: { tpr: number; tnr: number; accuracy: number; total: number } | null;
  isActive: boolean;
  onClick?: () => void;
  isEmpty?: boolean;
}) {
  const baseCls =
    "flex-1 bg-bg-elevated border rounded-lg px-4 py-3 transition-all";
  const activeCls = isActive
    ? "border-accent shadow-[0_0_0_1px_rgb(110,231,183,0.3)]"
    : "border-border";
  const clickableCls = onClick && !isEmpty ? "cursor-pointer hover:border-accent/50" : "";

  return (
    <div
      onClick={onClick && !isEmpty ? onClick : undefined}
      className={`${baseCls} ${activeCls} ${clickableCls}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
          {title}
        </div>
        {isActive && (
          <span className="text-[10px] text-accent">VIEWING</span>
        )}
      </div>
      {isEmpty || !metrics ? (
        <div className="text-xs text-text-dim/60">Not run yet</div>
      ) : (
        <div className="flex items-center gap-4">
          <MetricBadge label="TPR" value={metrics.tpr} />
          <MetricBadge label="TNR" value={metrics.tnr} />
          <MetricBadge label="Acc" value={metrics.accuracy} />
          <div className="text-[10px] text-text-dim ml-auto">
            n={metrics.total}
          </div>
        </div>
      )}
    </div>
  );
}

export function ValidatePanel({ config, experimentId }: ValidatePanelProps) {
  const startValidation = useMutation(api.evaluator.crud.startValidation);
  const [runningType, setRunningType] = useState<"dev" | "test" | null>(null);
  const [viewMode, setViewMode] = useState<"dev" | "test">("dev");
  const [filter, setFilter] = useState<
    "all" | "disagree" | "false_pass" | "false_fail"
  >("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

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

  // Auto-switch view mode to whichever just finished
  useEffect(() => {
    if (latestTestRun && !latestDevRun) setViewMode("test");
    else if (latestTestRun && config.testMetrics && !config.devMetrics)
      setViewMode("test");
  }, [latestTestRun?._id]);

  // Check for in-progress runs
  const runningRun = runs?.find(
    (r) => r.status === "pending" || r.status === "running",
  );

  // Pick which run to display based on viewMode
  const displayRunId =
    viewMode === "test" ? latestTestRun?._id : latestDevRun?._id;
  const results = useQuery(
    api.evaluator.crud.resultsByRun,
    displayRunId ? { runId: displayRunId } : "skip",
  );

  // Reset selected row when view mode changes
  useEffect(() => {
    setSelectedRowId(null);
  }, [viewMode]);

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

  // Load source experiment results to fetch agent answers
  const agentResults = useQuery(api.experiments.agentResults.byExperiment, {
    experimentId,
  });
  const agentResultByQuestion = new Map(
    (agentResults ?? []).map((r) => [r.questionId, r]),
  );

  // Load annotations for the selected row's tags/comment
  const annotations = useQuery(api.annotations.crud.byExperiment, {
    experimentId,
  });
  const annotationByQuestion = new Map(
    (annotations ?? []).map((a) => [a.questionId, a]),
  );

  const handleRunValidation = async (type: "dev" | "test") => {
    setRunningType(type);
    try {
      await startValidation({
        evaluatorConfigId: config._id,
        runType: type,
      });
      setViewMode(type);
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

  const selectedResult = selectedRowId
    ? (results ?? []).find((r) => r._id === selectedRowId)
    : null;
  const selectedQuestion = selectedResult
    ? questionMap.get(selectedResult.questionId)
    : null;
  const selectedAgentResult = selectedResult
    ? agentResultByQuestion.get(selectedResult.questionId)
    : null;
  const selectedAnnotation = selectedResult
    ? annotationByQuestion.get(selectedResult.questionId)
    : null;

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Left column: actions, metrics, filter, table */}
      <div
        className={`flex flex-col overflow-hidden p-6 min-h-0 ${
          selectedResult ? "w-1/2 border-r border-border" : "flex-1"
        }`}
      >
        {/* Actions bar */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => handleRunValidation("dev")}
            disabled={!!runningRun || runningType === "dev"}
            className="px-4 py-2 bg-accent text-bg rounded-lg hover:bg-accent/90 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed enabled:cursor-pointer"
          >
            {runningRun?.runType === "dev"
              ? "Running Dev..."
              : "Run on Dev Set"}
          </button>
          <button
            onClick={() => handleRunValidation("test")}
            disabled={
              !!runningRun || !config.devMetrics || runningType === "test"
            }
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

        {/* Side-by-side metric cards (clickable to switch view) */}
        {(config.devMetrics || config.testMetrics) && (
          <div className="flex gap-3 mb-4">
            <MetricCard
              title="Dev Set"
              metrics={config.devMetrics}
              isActive={viewMode === "dev"}
              onClick={() => setViewMode("dev")}
              isEmpty={!config.devMetrics}
            />
            <MetricCard
              title="Test Set"
              metrics={config.testMetrics}
              isActive={viewMode === "test"}
              onClick={() => setViewMode("test")}
              isEmpty={!config.testMetrics}
            />
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

            <div className="flex-1 overflow-y-auto border border-border rounded-lg min-h-0">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevated sticky top-0">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-medium text-text-dim">
                      Question
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-20">
                      Human
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-20">
                      Judge
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-text-dim w-16">
                      ✓
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => {
                    const q = questionMap.get(r.questionId);
                    const isFP =
                      r.judgeVerdict === "pass" &&
                      r.humanLabel === "fail";
                    const isFN =
                      r.judgeVerdict === "fail" &&
                      r.humanLabel === "pass";
                    const isSelected = selectedRowId === r._id;

                    const rowBg = isSelected
                      ? "bg-accent/5"
                      : isFP
                        ? "bg-red-500/5"
                        : isFN
                          ? "bg-orange-500/5"
                          : "";

                    return (
                      <tr
                        key={r._id}
                        onClick={() =>
                          setSelectedRowId(isSelected ? null : r._id)
                        }
                        className={`border-b border-border cursor-pointer hover:bg-bg-hover transition-colors ${rowBg}`}
                      >
                        <td className="px-3 py-2">
                          <div className="text-text truncate max-w-md">
                            {q?.queryText ?? "Unknown"}
                          </div>
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

      {/* Right column: question detail pane (full height) */}
      {selectedResult && (
        <div className="w-1/2 flex flex-col overflow-hidden bg-bg-elevated min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wide">
              Question Detail
            </div>
            <button
              onClick={() => setSelectedRowId(null)}
              className="text-text-dim hover:text-text text-base cursor-pointer leading-none"
              title="Close"
            >
              &times;
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {/* Verdict comparison */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-dim uppercase">
                  Human
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded ${
                    selectedResult.humanLabel === "pass"
                      ? "bg-accent/10 text-accent"
                      : "bg-red-400/10 text-red-400"
                  }`}
                >
                  {selectedResult.humanLabel === "pass" ? "Pass" : "Fail"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-dim uppercase">
                  Judge
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded ${
                    selectedResult.judgeVerdict === "pass"
                      ? "bg-accent/10 text-accent"
                      : "bg-red-400/10 text-red-400"
                  }`}
                >
                  {selectedResult.judgeVerdict === "pass" ? "Pass" : "Fail"}
                </span>
              </div>
              {selectedResult.agreesWithHuman === false && (
                <span className="text-[10px] font-medium text-yellow-400 uppercase">
                  Disagreement
                </span>
              )}
            </div>

            {/* Question */}
            <div>
              <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                Question
              </div>
              <div className="text-sm text-text whitespace-pre-wrap">
                {selectedQuestion?.queryText ?? "Unknown"}
              </div>
            </div>

            {/* Agent Answer */}
            <div>
              <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                Agent Answer
              </div>
              <div className="text-sm text-text whitespace-pre-wrap bg-bg rounded border border-border p-2">
                {selectedAgentResult?.answerText ?? "(no answer)"}
              </div>
            </div>

            {/* Judge Reasoning */}
            <div>
              <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                Judge Reasoning
              </div>
              <div className="text-sm text-text-dim italic whitespace-pre-wrap bg-bg rounded border border-border p-2">
                {selectedResult.judgeReasoning}
              </div>
            </div>

            {/* Human annotation context */}
            {selectedAnnotation && (
              <>
                {selectedAnnotation.comment && (
                  <div>
                    <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                      Human Comment
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap">
                      {selectedAnnotation.comment}
                    </div>
                  </div>
                )}
                {selectedAnnotation.tags &&
                  selectedAnnotation.tags.length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                        Tags
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnnotation.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 bg-bg border border-border rounded text-text-dim"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </>
            )}

            {/* Retrieved chunks */}
            {selectedAgentResult?.retrievedChunks &&
              selectedAgentResult.retrievedChunks.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide mb-1">
                    Retrieved Context (
                    {selectedAgentResult.retrievedChunks.length} chunks)
                  </div>
                  <div className="text-xs text-text-dim bg-bg rounded border border-border p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {selectedAgentResult.retrievedChunks
                      .map((c: any) => c.content)
                      .join("\n\n---\n\n")}
                  </div>
                </div>
              )}

            {/* Metadata footer */}
            {selectedResult.usage && (
              <div className="text-[10px] text-text-dim/60 pt-2 border-t border-border">
                {selectedResult.usage.promptTokens} prompt /{" "}
                {selectedResult.usage.completionTokens} completion tokens
                {selectedResult.latencyMs &&
                  ` · ${selectedResult.latencyMs}ms`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
