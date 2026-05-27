"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

type Scenario = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.scenarios.bySet>>
>[number];

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const summary =
    scenario.instruction.length > 60
      ? scenario.instruction.slice(0, 60) + "…"
      : scenario.instruction;
  const sourceKind = scenario.source.kind;
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-accent">
          {sourceKind}
        </span>
        <span className="text-[10px] text-text-dim capitalize">
          {scenario.complexity}
        </span>
      </div>
      <p className="text-xs text-text mb-3">{summary}</p>
      <dl className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <dt className="text-text-dim">Topic</dt>
          <dd className="text-text">{scenario.topic}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Intent</dt>
          <dd className="text-text">{scenario.intent}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Persona</dt>
          <dd className="text-text">{scenario.persona.type}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function SetDetailPage() {
  const params = useParams<{ id: string; setId: string }>();
  const agentId = params.id as Id<"agents">;
  const setId = params.setId as Id<"scenarioSets">;
  const router = useRouter();

  const set = useQuery(api.conversationSim.scenarioSets.get, { id: setId });
  const scenarios = useQuery(api.conversationSim.scenarios.bySet, {
    scenarioSetId: setId,
  });

  if (set === null) {
    return <div className="p-6 text-sm text-text-dim">Set not found.</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <button
          onClick={() => router.push(`/agents/${agentId}/evaluate/scenarios`)}
          className="text-[10px] text-text-dim hover:text-accent mb-2"
        >
          ← Back to scenario sets
        </button>
        <h1 className="text-sm font-medium text-text">
          {set?.name ?? "Loading…"}
        </h1>
        {set && (
          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-dim">
            <span className="uppercase tracking-wider text-accent">
              {set.source}
            </span>
            <span>{set.scenarioCount} scenarios</span>
            <span>
              Created{" "}
              {new Date(set.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {scenarios === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scenarios.map((s) => (
              <ScenarioCard key={s._id} scenario={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
