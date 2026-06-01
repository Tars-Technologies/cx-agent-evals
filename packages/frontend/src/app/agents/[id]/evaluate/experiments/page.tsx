"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { CreateSimulationModal } from "@/components/conversation-sim/CreateSimulationModal";

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

function SimulationRow({
  sim,
  agentId,
}: {
  sim: Simulation;
  agentId: Id<"agents">;
}) {
  const router = useRouter();
  const set = useQuery(api.conversationSim.scenarioSets.get, {
    id: sim.scenarioSetId,
  });
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
        <p className="text-[10px] text-text-dim">Set: {set?.name ?? "—"}</p>
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
  const router = useRouter();

  const simulations = useQuery(api.conversationSim.orchestration.byAgent, {
    agentId,
  });
  const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
  const cancelSimulation = useMutation(api.conversationSim.orchestration.cancel);

  const [showModal, setShowModal] = useState(false);

  const hasSets = (sets?.length ?? 0) > 0;

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
          disabled={!hasSets}
          title={!hasSets ? "Generate a scenario set first" : undefined}
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
              {hasSets
                ? "Click '+ New Simulation' to run one."
                : "Generate a scenario set first, then run a simulation."}
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

      {showModal && (
        <CreateSimulationModal
          agentId={agentId}
          onClose={() => setShowModal(false)}
          onCreated={(simId) => {
            setShowModal(false);
            router.push(`/agents/${agentId}/evaluate/experiments/${simId}`);
          }}
        />
      )}
    </div>
  );
}
