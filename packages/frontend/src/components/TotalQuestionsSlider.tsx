"use client";

import type { StrategyType } from "@/lib/types";

const HELPER_TEXT: Record<StrategyType, (numDocs: number, total: number) => string> = {
  simple: (numDocs, total) => {
    const perDoc = Math.ceil(total / numDocs);
    return `Distributed equally across ${numDocs} document${numDocs !== 1 ? "s" : ""} (~${perDoc}/doc)`;
  },
  "dimension-driven": () =>
    "Distributed via stratified sampling across dimension combos",
  "real-world-grounded": () =>
    "Direct matches + synthetic generation to fill remaining",
};

export function TotalQuestionsSlider({
  value,
  onChange,
  strategy,
  numDocs,
}: {
  value: number;
  onChange: (n: number) => void;
  strategy: StrategyType;
  numDocs: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[11px] text-text-muted uppercase tracking-wider">
          Total questions to generate
        </label>
        <span className="text-lg font-semibold text-accent tabular-nums">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1 bg-bg-surface rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-2
                   [&::-webkit-slider-thumb]:border-bg-elevated
                   [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(110,231,183,0.3)]"
      />
      <div className="flex justify-between text-[9px] text-text-dim mt-0.5">
        <span>1</span>
        <span>100</span>
      </div>
      <p className="text-[10px] text-text-dim mt-1.5">
        {HELPER_TEXT[strategy](numDocs, value)}
      </p>
    </div>
  );
}
