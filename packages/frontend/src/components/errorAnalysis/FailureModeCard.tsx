"use client";

import { useState } from "react";
import { Id } from "@convex/_generated/dataModel";

interface FailureModeCardProps {
  failureMode: {
    _id: Id<"failureModes">;
    name: string;
    description: string;
    errorAnalysisId: Id<"errorAnalyses">;
    agentId: Id<"agents">;
  };
  memberCount: number;
  judgeCount: number;
  onSpawnJudge(): Promise<void>;
  onSpawnedJudgesClick?(): void;
}

export function FailureModeCard({
  failureMode,
  memberCount,
  judgeCount,
  onSpawnJudge,
  onSpawnedJudgesClick,
}: FailureModeCardProps) {
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSpawn() {
    if (spawning) return;
    setSpawning(true);
    setError(null);
    try {
      await onSpawnJudge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to spawn judge");
    } finally {
      setSpawning(false);
    }
  }

  return (
    <div className="border border-zinc-800 bg-zinc-900 rounded p-3 flex flex-col gap-2">
      <div>
        <div className="text-sm font-semibold text-zinc-100">
          {failureMode.name}
        </div>
        <div className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">
          {failureMode.description}
        </div>
      </div>

      <div className="text-xs text-zinc-500">
        {memberCount} convs in this mode
      </div>

      {judgeCount > 0 && (
        onSpawnedJudgesClick ? (
          <button
            onClick={onSpawnedJudgesClick}
            className="text-xs text-accent hover:underline text-left"
          >
            {judgeCount} judge{judgeCount === 1 ? "" : "s"} spawned →
          </button>
        ) : (
          <div className="text-xs text-zinc-400">
            {judgeCount} judge{judgeCount === 1 ? "" : "s"} spawned
          </div>
        )
      )}

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      <div className="pt-1">
        <button
          onClick={handleSpawn}
          disabled={spawning}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {spawning ? "Spawning…" : "Spawn judge"}
        </button>
      </div>
    </div>
  );
}
