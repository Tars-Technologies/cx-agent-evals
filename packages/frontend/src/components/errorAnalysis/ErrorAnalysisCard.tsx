"use client";

import { Id } from "@convex/_generated/dataModel";

interface ErrorAnalysisCardProps {
  analysis: {
    _id: Id<"errorAnalyses">;
    name: string;
    origin: { kind: "simulation" | "upload" | "playground" | "custom"; [k: string]: unknown };
    memberCount: number;
    annotatedCount: number;
    failureModeCount: number;
    judgeCount: number;
    createdAt: number;
  };
  onClick(): void;
}

const ORIGIN_LABEL: Record<string, string> = {
  simulation: "SIMULATION RUN",
  upload: "UPLOAD",
  playground: "PLAYGROUND",
  custom: "CUSTOM COHORT",
};

export function ErrorAnalysisCard({ analysis, onClick }: ErrorAnalysisCardProps) {
  const originLabel = ORIGIN_LABEL[analysis.origin.kind] ?? analysis.origin.kind.toUpperCase();
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
      className="border border-zinc-800 bg-zinc-900 rounded p-3 hover:border-zinc-600 cursor-pointer transition-colors"
    >
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
        {originLabel}
      </div>
      <div className="text-sm font-semibold text-zinc-100 mb-2 truncate">
        {analysis.name}
      </div>
      <div className="text-xs text-zinc-400">
        {analysis.memberCount} convs · {analysis.annotatedCount} annotated
      </div>
      <div className="text-xs text-zinc-400">
        {analysis.failureModeCount} failure modes · {analysis.judgeCount} judges
      </div>
    </div>
  );
}
