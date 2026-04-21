"use client";

import { useState } from "react";

interface Scenario {
  _id: string;
  persona: {
    type: string;
    traits: string[];
    communicationStyle: string;
    patienceLevel: "low" | "medium" | "high";
  };
  topic: string;
  intent: string;
  complexity: "low" | "medium" | "high";
  reasonForContact: string;
  instruction: string;
}

export function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  onEdit,
}: {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [complexityFilter, setComplexityFilter] = useState<"all" | "low" | "medium" | "high">("all");

  const filtered = scenarios.filter(s => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!s.topic.toLowerCase().includes(q) &&
          !s.intent.toLowerCase().includes(q) &&
          !s.persona.type.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (complexityFilter !== "all" && s.complexity !== complexityFilter) return false;
    return true;
  });

  if (scenarios.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Scenarios will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">Scenarios</span>
        <span className="text-[11px] text-text-muted">{scenarios.length} total</span>
      </div>

      {/* Search + Filter */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search scenarios..."
          className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
        />
        <div className="flex gap-1">
          {(["all", "low", "medium", "high"] as const).map(level => (
            <button
              key={level}
              onClick={() => setComplexityFilter(level)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                complexityFilter === level
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "text-text-dim hover:text-text border border-transparent"
              }`}
            >
              {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Scenario Items */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(scenario => (
          <div
            key={scenario._id}
            onClick={() => onSelect(scenario._id)}
            className={`group relative px-3 py-2.5 border-b border-border cursor-pointer transition-colors ${
              selectedId === scenario._id
                ? "bg-accent/10 border-l-2 border-l-accent"
                : "hover:bg-bg-elevated/50 border-l-2 border-l-transparent"
            }`}
          >
            {/* Topic + Intent */}
            <div className="text-xs text-text font-medium truncate">{scenario.topic}</div>
            <div className="text-[11px] text-text-dim mt-0.5 truncate">{scenario.intent}</div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {/* Persona type */}
              <span className="px-1.5 py-0.5 text-[9px] rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                {scenario.persona.type}
              </span>
              {/* Complexity */}
              <span className={`px-1.5 py-0.5 text-[9px] rounded border ${
                scenario.complexity === "high"
                  ? "bg-red-500/15 text-red-400 border-red-500/20"
                  : scenario.complexity === "medium"
                    ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
                    : "bg-green-500/15 text-green-400 border-green-500/20"
              }`}>
                {scenario.complexity}
              </span>
              {/* Communication style */}
              <span className="px-1.5 py-0.5 text-[9px] rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                {scenario.persona.communicationStyle}
              </span>
            </div>

            {/* Edit button (on hover) */}
            {onEdit && (
              <button
                onClick={e => { e.stopPropagation(); onEdit(scenario._id); }}
                className="hidden group-hover:inline-flex absolute right-2 top-2 p-1 text-text-dim hover:text-accent"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-xs text-text-dim text-center">
            No scenarios match filters
          </div>
        )}
      </div>
    </div>
  );
}
