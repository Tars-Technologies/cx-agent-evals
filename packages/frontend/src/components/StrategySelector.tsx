"use client"

import type { StrategyType } from "@/lib/types"

export function StrategySelector({
  value,
  onChange
}: {
  value: StrategyType
  onChange: (strategy: StrategyType) => void
}) {
  return (
    <div className="animate-fade-in">
      <div className="mb-3">
        <span className="text-xs text-text-dim uppercase tracking-wider">
          Strategy
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StrategyCard
          label="Simple"
          description="Prompt-based"
          selected={value === "simple"}
          onClick={() => onChange("simple")}
        />
        <StrategyCard
          label="Dimensions"
          description="Structured diversity"
          selected={value === "dimension-driven"}
          onClick={() => onChange("dimension-driven")}
        />
        <StrategyCard
          label="Real-World"
          description="Grounded in real Qs"
          selected={value === "real-world-grounded"}
          onClick={() => onChange("real-world-grounded")}
        />
      </div>
    </div>
  )
}

function StrategyCard({
  label,
  description,
  selected,
  onClick
}: {
  label: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative p-3 rounded-lg border text-left transition-all cursor-pointer
        ${
          selected
            ? "border-accent/50 bg-accent/5"
            : "border-border bg-bg-surface hover:border-accent/30 hover:bg-bg-hover"
        }
      `}
    >
      {selected && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-accent" />
      )}
      <span className="block text-xs font-semibold text-text">{label}</span>
      <span className="block text-[10px] text-text-muted mt-0.5">
        {description}
      </span>
    </button>
  )
}
