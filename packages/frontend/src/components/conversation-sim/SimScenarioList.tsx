"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function SimScenarioList({
  simulationId,
  simulation,
  selectedRunId,
  onSelectRun,
  phase,
  onPhaseChange,
}: {
  simulationId: Id<"conversationSimulations">;
  simulation: any | null | undefined;
  selectedRunId: Id<"conversationSimRuns"> | null;
  onSelectRun: (id: Id<"conversationSimRuns">) => void;
  phase: "conversations" | "evaluation";
  onPhaseChange: (phase: "conversations" | "evaluation") => void;
}) {
  const runs = useQuery(
    api.conversationSim.runs.bySimulation,
    { simulationId },
  ) ?? [];

  const [showEvalModal, setShowEvalModal] = useState(false);
  const [selectedEvalSetId, setSelectedEvalSetId] = useState<Id<"evaluatorSets"> | "">("");
  const [startingEval, setStartingEval] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const evaluatorSets = useQuery(api.conversationSim.evaluatorSets.byOrg) ?? [];
  const startEvaluation = useMutation(api.conversationSim.orchestration.startEvaluation);

  // Group runs by scenarioId
  const grouped = new Map<string, typeof runs>();
  for (const run of runs) {
    const key = run.scenarioId as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(run);
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        No runs yet
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border bg-bg-elevated/50">
        <div className="px-3 pt-2">
          <span className="text-[11px] text-text-dim uppercase tracking-wider">
            Scenarios ({grouped.size})
          </span>
        </div>
        <div className="px-3 py-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => onPhaseChange("conversations")}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                phase === "conversations" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
              }`}
            >
              Conversations
            </button>
            <button
              onClick={() => onPhaseChange("evaluation")}
              disabled={simulation?.status !== "completed"}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                phase === "evaluation" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              Evaluation
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {phase === "evaluation" && (!simulation?.evaluationStatus || simulation.evaluationStatus === "not_started") ? (
          <div className="p-4 text-center space-y-3 mt-8">
            <p className="text-xs text-text-dim">Conversations complete. Run evaluation to score them.</p>
            <button
              onClick={() => setShowEvalModal(true)}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-bg-elevated hover:bg-accent/90 transition-colors"
            >
              Evaluate
            </button>
          </div>
        ) : (
        [...grouped.entries()].map(([scenarioId, scenarioRuns], scenarioIndex) => {
          const allConversationsComplete = scenarioRuns.every(r => r.status === "completed" || r.status === "failed");
          const isRunning = scenarioRuns.some(r => r.status === "running");
          const allPassed = scenarioRuns.every(r => r.passed);
          const evaluationDone = simulation?.evaluationStatus === "completed";
          const isSelected = scenarioRuns.some(r => r._id === selectedRunId);
          const scenarioLabel = `SCE-${String(scenarioIndex + 1).padStart(3, "0")}`;
          const topic = scenarioRuns[0]?.scenarioTopic;

          return (
            <div
              key={scenarioId}
              onClick={() => onSelectRun(scenarioRuns[0]._id)}
              className={`border-b border-border cursor-pointer transition-colors ${
                isSelected ? "bg-accent/5" : "hover:bg-bg-elevated/50"
              }`}
            >
              {/* Scenario header */}
              <div className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-text font-medium truncate block">
                      {scenarioLabel}
                    </span>
                    {topic && (
                      <div className="text-[10px] text-text-dim truncate mt-0.5">
                        {topic}
                      </div>
                    )}
                  </div>
                  {phase === "conversations" ? (
                    <span className={`flex-shrink-0 ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      allConversationsComplete
                        ? "bg-green-500/15 text-green-400"
                        : isRunning
                          ? "bg-accent/15 text-accent"
                          : "bg-yellow-500/15 text-yellow-400"
                    }`}>
                      {allConversationsComplete ? "DONE" : isRunning ? "RUNNING" : "PENDING"}
                    </span>
                  ) : evaluationDone ? (
                    <span className={`flex-shrink-0 ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      allPassed
                        ? "bg-green-500/15 text-green-400"
                        : "bg-red-500/15 text-red-400"
                    }`}>
                      {allPassed ? "PASS" : "FAIL"}
                    </span>
                  ) : null}
                </div>
                {/* Run dots */}
                <div className="flex gap-1.5 mt-1.5">
                  {scenarioRuns.map((run, i) => (
                    <button
                      key={run._id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRun(run._id);
                      }}
                      className={`group flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                        run._id === selectedRunId
                          ? "bg-accent/20 text-accent"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${
                        run.status === "running" || run.status === "pending"
                          ? "bg-accent animate-pulse"
                          : run.passed
                            ? "bg-green-400"
                            : "bg-red-400"
                      }`} />
                      Run {i + 1}
                      {run.score != null && (
                        <span className="text-text-dim">{(run.score * 100).toFixed(0)}%</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })
        )}
      </div>

      {showEvalModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => !startingEval && setShowEvalModal(false)}>
          <div className="bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-text mb-1">Run Evaluation</h3>
            <p className="text-xs text-text-dim mb-4">Pick an evaluator set to score the {grouped.size} scenarios in this simulation.</p>
            <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">Evaluator Set</label>
            <select
              value={selectedEvalSetId}
              onChange={e => setSelectedEvalSetId(e.target.value as Id<"evaluatorSets">)}
              className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
            >
              <option value="">Select evaluator set...</option>
              {evaluatorSets.map(es => (
                <option key={es._id} value={es._id}>
                  {es.name} ({es.evaluatorIds.length} evaluators)
                </option>
              ))}
            </select>
            {evalError && <p className="text-xs text-red-400 mt-2">{evalError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowEvalModal(false)}
                disabled={startingEval}
                className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!selectedEvalSetId) return;
                  setStartingEval(true);
                  setEvalError(null);
                  try {
                    await startEvaluation({
                      simulationId,
                      evaluatorSetId: selectedEvalSetId as Id<"evaluatorSets">,
                    });
                    setShowEvalModal(false);
                    setSelectedEvalSetId("");
                  } catch (err) {
                    setEvalError(err instanceof Error ? err.message : "Failed to start evaluation");
                  } finally {
                    setStartingEval(false);
                  }
                }}
                disabled={!selectedEvalSetId || startingEval}
                className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {startingEval ? "Starting..." : "Run Evaluation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
