"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

export function ScenarioGenerationWizard({
  kbId,
  onGenerated,
  onError,
  onCancel,
}: {
  kbId: Id<"knowledgeBases">;
  onGenerated: (datasetId: Id<"datasets">) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}) {
  const createSimDataset = useMutation(api.crud.datasets.createSimDataset);
  const startGeneration = useMutation(
    api.conversationSim.generation.startGeneration,
  );

  const [name, setName] = useState("");
  const [count, setCount] = useState(10);
  const [generating, setGenerating] = useState(false);

  // Complexity distribution
  const [lowPct, setLowPct] = useState(30);
  const [medPct, setMedPct] = useState(50);
  const [highPct, setHighPct] = useState(20);

  async function handleGenerate() {
    if (!name.trim()) return;
    setGenerating(true);
    try {
      // 1. Create the conversation_sim dataset
      const datasetId = await createSimDataset({
        kbId,
        name: name.trim(),
      });

      // 2. Start generation
      await startGeneration({
        datasetId,
        count,
        complexityDistribution: {
          low: lowPct / 100,
          medium: medPct / 100,
          high: highPct / 100,
        },
      });

      onGenerated(datasetId);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  // Ensure percentages sum to 100
  function adjustDistribution(
    changed: "low" | "medium" | "high",
    value: number,
  ) {
    const clamped = Math.max(0, Math.min(100, value));
    if (changed === "low") {
      setLowPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        medPct + highPct > 0 ? medPct / (medPct + highPct) : 0.5;
      setMedPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else if (changed === "medium") {
      setMedPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        lowPct + highPct > 0 ? lowPct / (lowPct + highPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setHighPct(remaining - Math.round(remaining * ratio));
    } else {
      setHighPct(clamped);
      const remaining = 100 - clamped;
      const ratio =
        lowPct + medPct > 0 ? lowPct / (lowPct + medPct) : 0.5;
      setLowPct(Math.round(remaining * ratio));
      setMedPct(remaining - Math.round(remaining * ratio));
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-sm font-medium text-text mb-4">
        Generate Conversation Scenarios
      </h2>
      <p className="text-xs text-text-dim mb-6">
        Analyze your knowledge base documents to generate diverse conversation
        scenarios for testing your AI agent.
      </p>

      <div className="space-y-5">
        {/* Dataset Name */}
        <div>
          <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
            Dataset Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Support Scenarios v1"
            className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
        </div>

        {/* Scenario Count */}
        <div>
          <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
            Number of Scenarios
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="flex-1 accent-[#6ee7b7]"
            />
            <span className="text-xs text-text w-8 text-right">{count}</span>
          </div>
        </div>

        {/* Complexity Distribution */}
        <div>
          <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Complexity Distribution
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-green-400">Low</span>
                <span className="text-[10px] text-text-dim">{lowPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={lowPct}
                onChange={(e) =>
                  adjustDistribution("low", Number(e.target.value))
                }
                className="w-full accent-green-400"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-yellow-400">Medium</span>
                <span className="text-[10px] text-text-dim">{medPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={medPct}
                onChange={(e) =>
                  adjustDistribution("medium", Number(e.target.value))
                }
                className="w-full accent-yellow-400"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-red-400">High</span>
                <span className="text-[10px] text-text-dim">{highPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={highPct}
                onChange={(e) =>
                  adjustDistribution("high", Number(e.target.value))
                }
                className="w-full accent-red-400"
              />
            </div>
          </div>
          {/* Distribution bar */}
          <div className="flex h-1.5 rounded-full overflow-hidden mt-2">
            <div className="bg-green-400" style={{ width: `${lowPct}%` }} />
            <div className="bg-yellow-400" style={{ width: `${medPct}%` }} />
            <div className="bg-red-400" style={{ width: `${highPct}%` }} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 mt-8 pt-4 border-t border-border">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleGenerate}
          disabled={!name.trim() || generating}
          className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? "Starting..." : `Generate ${count} Scenarios`}
        </button>
      </div>
    </div>
  );
}
