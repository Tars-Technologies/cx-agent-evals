"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

// Derive a run's evaluation verdict/score from its evaluatorResults, which are the
// real source of truth. The scalar run.passed/run.score may be unset on older runs,
// so deriving here keeps the badge correct regardless. null = not evaluated.
function runVerdict(run: { evaluatorResults?: { passed: boolean }[] }): boolean | null {
  const er = run.evaluatorResults;
  if (!er || er.length === 0) return null;
  return er.every((x) => x.passed);
}
function runScore(run: { evaluatorResults?: { passed: boolean }[] }): number | null {
  const er = run.evaluatorResults;
  if (!er || er.length === 0) return null;
  return er.filter((x) => x.passed).length / er.length;
}

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
        {[...grouped.entries()].map(([scenarioId, scenarioRuns], scenarioIndex) => {
          const allConversationsComplete = scenarioRuns.every(r => r.status === "completed" || r.status === "failed");
          const isRunning = scenarioRuns.some(r => r.status === "running");
          const verdicts = scenarioRuns.map((r) => runVerdict(r));
          // "Not evaluated" (no judges ran / no verdicts) is distinct from FAIL —
          // only show PASS/FAIL once at least one run has a real verdict.
          const evaluated = verdicts.some((v) => v !== null);
          const allPassed = scenarioRuns.length > 0 && verdicts.every((v) => v === true);
          const evaluationDone = simulation?.status === "completed";
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
                    !evaluated ? (
                      <span className="flex-shrink-0 ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-text-dim/10 text-text-dim">
                        NOT EVALUATED
                      </span>
                    ) : (
                      <span className={`flex-shrink-0 ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        allPassed
                          ? "bg-green-500/15 text-green-400"
                          : "bg-red-500/15 text-red-400"
                      }`}>
                        {allPassed ? "PASS" : "FAIL"}
                      </span>
                    )
                  ) : null}
                </div>
                {/* Run dots */}
                <div className="flex gap-1.5 mt-1.5">
                  {scenarioRuns.map((run, i) => {
                    const verdict = runVerdict(run);
                    const score = runScore(run);
                    return (
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
                          : phase === "conversations"
                            ? run.status === "completed"
                              ? "bg-green-400"
                              : "bg-red-400"
                            : verdict == null
                              ? "bg-text-dim/40"
                              : verdict
                                ? "bg-green-400"
                                : "bg-red-400"
                      }`} />
                      Run {i + 1}
                      {score != null && (
                        <span className="text-text-dim">{(score * 100).toFixed(0)}%</span>
                      )}
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
