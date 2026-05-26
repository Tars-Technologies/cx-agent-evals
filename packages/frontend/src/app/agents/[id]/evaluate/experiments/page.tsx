"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

type Simulation = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.orchestration.byAgent>>
>[number];

type SimStatus = Simulation["status"];

const STATUS_BADGE: Record<SimStatus, string> = {
  running: "bg-accent/15 text-accent",
  completed: "bg-accent/15 text-accent",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-border text-text-dim",
  pending: "bg-yellow-500/15 text-yellow-400",
};

function formatDate(ts: number | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActiveBanner({
  sims,
  onCancel,
}: {
  sims: Simulation[];
  onCancel: (id: Id<"conversationSimulations">) => Promise<void>;
}) {
  const active = sims.filter(
    (s) => s.status === "running" || s.status === "pending",
  );
  if (active.length === 0) return null;

  return (
    <div className="mx-6 mt-4 bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 space-y-2 shrink-0">
      <p className="text-[11px] uppercase tracking-wider text-accent font-medium mb-2">
        Active
      </p>
      {active.map((sim) => (
        <div key={sim._id} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text truncate">
              {sim._id.slice(-6)}
            </p>
            <p className="text-[10px] text-text-dim">
              {sim.completedRuns} / {sim.totalRuns} runs complete
            </p>
          </div>
          <div className="w-32 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{
                width: `${sim.totalRuns > 0 ? (sim.completedRuns / sim.totalRuns) * 100 : 0}%`,
              }}
            />
          </div>
          <button
            onClick={() => onCancel(sim._id)}
            className="text-[10px] text-text-dim hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-400/10 shrink-0"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}

// NOTE: CreateSimulationModal requires a `datasetId` prop and calls
// orchestration.start with { agentId, datasetId, k, concurrency, maxTurns, timeoutMs }.
// However, orchestration.start was updated in Phase 1 to take only { agentId } and
// load scenarios directly — the datasetId param was removed. The modal is incompatible
// and must be rebuilt in a future task. The "+ New Simulation" button shows a
// placeholder message until then.
function ComingSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-sm p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-text mb-2">Coming soon</p>
        <p className="text-xs text-text-dim leading-relaxed">
          The &ldquo;New Simulation&rdquo; modal needs to be rebuilt after the
          Phase 1 orchestration refactor removed the{" "}
          <code className="text-accent">datasetId</code> parameter. This is
          tracked for a follow-up task.
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}

function SimulationRow({
  sim,
  agentId,
}: {
  sim: Simulation;
  agentId: Id<"agents">;
}) {
  const router = useRouter();
  const badgeCls = STATUS_BADGE[sim.status] ?? "bg-border text-text-dim";

  return (
    <button
      className="w-full text-left px-4 py-3 border border-border rounded-lg bg-bg-elevated hover:bg-bg-surface transition-colors flex items-center gap-4"
      onClick={() =>
        router.push(`/agents/${agentId}/evaluate/experiments/${sim._id}`)
      }
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text font-mono">{sim._id.slice(-12)}</p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeCls}`}
          >
            {sim.status}
          </span>
          <span className="text-[10px] text-text-dim">
            {sim.totalRuns} runs
          </span>
        </div>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-[10px] text-text-dim">
          Started {formatDate(sim.startedAt)}
        </p>
        {sim.completedAt && (
          <p className="text-[10px] text-text-dim">
            Done {formatDate(sim.completedAt)}
          </p>
        )}
      </div>
      <span className="text-text-dim text-xs shrink-0">›</span>
    </button>
  );
}

export default function ExperimentsPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;

  const simulations = useQuery(api.conversationSim.orchestration.byAgent, {
    agentId,
  });
  const scenarios = useQuery(api.conversationSim.scenarios.byAgent, { agentId });
  const cancelSimulation = useMutation(api.conversationSim.orchestration.cancel);

  const [showModal, setShowModal] = useState(false);

  const hasScenarios = (scenarios?.length ?? 0) > 0;

  async function handleCancel(simulationId: Id<"conversationSimulations">) {
    await cancelSimulation({ simulationId });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-medium text-text">Experiments</h1>
        <button
          onClick={() => setShowModal(true)}
          disabled={!hasScenarios}
          title={
            !hasScenarios
              ? "Add scenarios to this agent before running a simulation"
              : undefined
          }
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>+</span> New Simulation
        </button>
      </div>

      {/* Active simulation banner */}
      {simulations && simulations.length > 0 && (
        <ActiveBanner sims={simulations} onCancel={handleCancel} />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {simulations === undefined ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : simulations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No simulations yet.</p>
            <p className="text-xs text-text-muted mt-1">
              {hasScenarios
                ? "Click '+ New Simulation' to run one."
                : "Add scenarios first, then run a simulation."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {simulations.map((sim) => (
              <SimulationRow key={sim._id} sim={sim} agentId={agentId} />
            ))}
          </div>
        )}
      </div>

      {showModal && <ComingSoonModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
