"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ScenarioGenerationWizard } from "@/components/ScenarioGenerationWizard";

type Set = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.scenarioSets.byAgent>>
>[number];

function SetCard({
  set,
  generating,
  generatingProgress,
  onClick,
  onDelete,
}: {
  set: Set;
  generating?: boolean;
  generatingProgress?: { generated: number; target: number };
  onClick: () => void;
  onDelete: () => void;
}) {
  const createdDate = new Date(set.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="text-left bg-bg-elevated border border-border rounded-lg p-4 hover:border-accent transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text truncate">{set.name}</h3>
        <span className="text-[10px] uppercase tracking-wider text-accent">
          {set.source}
        </span>
      </div>
      <div className="text-xs text-text-dim space-y-1">
        {generating && generatingProgress ? (
          <div className="flex items-center gap-2 text-accent">
            <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            <span>
              Generating {generatingProgress.generated} /{" "}
              {generatingProgress.target}
            </span>
          </div>
        ) : (
          <div>{set.scenarioCount} scenarios</div>
        )}
        <div>Created {createdDate}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="mt-3 text-[10px] text-text-dim hover:text-red-400"
      >
        Delete
      </button>
    </div>
  );
}

export default function ScenariosPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;
  const router = useRouter();

  const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
  const activeJob = useQuery(
    api.conversationSim.generation.getActiveJob,
    { agentId },
  );
  const removeSet = useMutation(api.conversationSim.scenarioSets.remove);

  const activeSet = activeJob?.scenarioSetId
    ? (sets ?? []).find((s) => s._id === activeJob.scenarioSetId) ?? null
    : null;

  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: Id<"scenarioSets">) {
    if (!confirm("Delete this scenario set and all its scenarios?")) return;
    try {
      await removeSet({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-medium text-text">Scenario sets</h1>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          <span>✨</span> Generate scenarios
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded">
          {error}
        </div>
      )}

      {activeJob && (
        <div className="mx-6 mt-4 bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              <span className="text-[11px] uppercase tracking-wider text-accent font-medium">
                Generating
              </span>
              {activeSet && (
                <span className="text-xs text-text">{activeSet.name}</span>
              )}
            </div>
            <span className="text-xs text-text-dim">
              {activeJob.generatedCount} / {activeJob.targetCount}
            </span>
          </div>
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{
                width: `${
                  activeJob.targetCount > 0
                    ? (activeJob.generatedCount / activeJob.targetCount) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sets === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : sets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No scenario sets yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &lsquo;✨ Generate scenarios&rsquo; to create one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sets.map((set) => {
              const isGenerating = activeJob?.scenarioSetId === set._id;
              return (
                <SetCard
                  key={set._id}
                  set={set}
                  generating={isGenerating}
                  generatingProgress={
                    isGenerating && activeJob
                      ? {
                          generated: activeJob.generatedCount,
                          target: activeJob.targetCount,
                        }
                      : undefined
                  }
                  onClick={() =>
                    router.push(
                      `/agents/${agentId}/evaluate/scenarios/${set._id}`,
                    )
                  }
                  onDelete={() => handleDelete(set._id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowWizard(false)}
          />
          <div
            className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <ScenarioGenerationWizard
              agentId={agentId}
              onGenerated={() => setShowWizard(false)}
              onError={(msg) => {
                setError(msg);
                setShowWizard(false);
              }}
              onCancel={() => setShowWizard(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
