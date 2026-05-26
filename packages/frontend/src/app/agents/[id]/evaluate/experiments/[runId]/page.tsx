"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { SimRunDetail } from "@/components/conversation-sim/SimRunDetail";
import { SimScenarioList } from "@/components/conversation-sim/SimScenarioList";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "bg-green-500/15 text-green-400"
      : status === "running"
        ? "bg-accent/15 text-accent"
        : status === "failed"
          ? "bg-red-500/15 text-red-400"
          : status === "cancelled"
            ? "bg-text-dim/20 text-text-dim"
            : "bg-yellow-500/15 text-yellow-400";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${cls}`}>
      {status}
    </span>
  );
}

// ── Metadata pane ─────────────────────────────────────────────────────────────

function SimMetadataBand({
  sim,
}: {
  sim: NonNullable<Awaited<ReturnType<typeof useQuery<typeof api.conversationSim.orchestration.get>>>>;
}) {
  const started = sim.startedAt ? new Date(sim.startedAt).toLocaleString() : null;
  const completed = sim.completedAt ? new Date(sim.completedAt).toLocaleString() : null;

  return (
    <div className="px-4 py-2.5 border-b border-border bg-bg-elevated/50 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {/* ID + status */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text font-medium font-mono">
          {sim._id.slice(-8)}
        </span>
        <StatusBadge status={sim.status} />
      </div>

      {/* Counts */}
      <div className="flex items-center gap-3 text-[11px] text-text-dim">
        <span>{sim.totalRuns} total</span>
        <span className="text-green-400">{sim.completedRuns} completed</span>
        {(sim.failedRuns ?? 0) > 0 && (
          <span className="text-red-400">{sim.failedRuns} failed</span>
        )}
      </div>

      {/* Model */}
      {sim.userSimModel && (
        <span className="text-[11px] text-text-dim font-mono">{sim.userSimModel}</span>
      )}

      {/* Pass rate */}
      {sim.overallPassRate != null && (
        <span className="text-[11px] text-text-dim">
          Pass rate: {(sim.overallPassRate * 100).toFixed(0)}%
        </span>
      )}

      {/* Timestamps */}
      {started && (
        <span className="text-[11px] text-text-dim ml-auto">Started {started}</span>
      )}
      {completed && (
        <span className="text-[11px] text-text-dim">Completed {completed}</span>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentExperimentRunPage() {
  const { id: agentId, runId } = useParams<{ id: string; runId: string }>();
  const simulationId = runId as Id<"conversationSimulations">;

  const sim = useQuery(api.conversationSim.orchestration.get, { id: simulationId });
  const runs = useQuery(api.conversationSim.runs.bySimulation, { simulationId });

  const [selectedRunId, setSelectedRunId] = useState<Id<"conversationSimRuns"> | null>(null);
  const [phase, setPhase] = useState<"conversations" | "evaluation">("conversations");

  // Auto-select the first run once loaded
  const effectiveRunId =
    selectedRunId ??
    (runs && runs.length > 0 ? runs[0]._id : null);

  // Loading
  if (sim === undefined || runs === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-xs">
        <div className="w-4 h-4 border-2 border-accent/40 border-t-accent rounded-full animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  // Simulation not found
  if (sim === null) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-xs">
        Simulation not found.
      </div>
    );
  }

  // No runs yet
  if (runs.length === 0) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <SimMetadataBand sim={sim} />
        <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
          No runs yet for this simulation.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Metadata strip */}
      <SimMetadataBand sim={sim} />

      {/* Two-column body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left: scenario / run list */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-hidden">
          <SimScenarioList
            simulationId={simulationId}
            simulation={sim}
            selectedRunId={effectiveRunId}
            onSelectRun={(id) => setSelectedRunId(id)}
            phase={phase}
            onPhaseChange={setPhase}
          />
        </div>

        {/* Right: run transcript */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {effectiveRunId ? (
            <SimRunDetail runId={effectiveRunId} />
          ) : (
            <div className="h-full flex items-center justify-center text-text-dim text-xs">
              Select a run on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
