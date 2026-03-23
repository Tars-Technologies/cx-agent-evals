"use client";

import { StrategyType, Dimension } from "@/lib/types";
import { StrategySelector } from "./StrategySelector";
import { DimensionSummary } from "./DimensionSummary";
import { TotalQuestionsSlider } from "./TotalQuestionsSlider";

export function GenerateConfig({
  onGenerate,
  disabled,
  generating,
  disabledReason,
  strategy,
  onStrategyChange,
  dimensions,
  totalQuestions,
  onTotalQuestionsChange,
  onOpenWizard,
  realWorldQuestions,
  onOpenRealWorldModal,
  numDocs,
}: {
  onGenerate: () => void;
  disabled: boolean;
  generating: boolean;
  disabledReason?: string;
  strategy: StrategyType;
  onStrategyChange: (strategy: StrategyType) => void;
  dimensions: Dimension[];
  totalQuestions: number;
  onTotalQuestionsChange: (n: number) => void;
  onOpenWizard: () => void;
  realWorldQuestions: string[];
  onOpenRealWorldModal: () => void;
  numDocs: number;
}) {
  const dimensionsConfigured = dimensions.length > 0;
  const realWorldConfigured = realWorldQuestions.length > 0;
  const canGenerate =
    strategy === "simple" ||
    (strategy === "dimension-driven" && dimensionsConfigured) ||
    (strategy === "real-world-grounded" && realWorldConfigured);

  return (
    <div className="animate-fade-in">
      <div className="space-y-4">
        <StrategySelector value={strategy} onChange={onStrategyChange} />

        <div className="border-t border-border pt-3 space-y-3">
          {/* Unified slider for all strategies */}
          <TotalQuestionsSlider
            value={totalQuestions}
            onChange={onTotalQuestionsChange}
            strategy={strategy}
            numDocs={numDocs}
          />

          {/* Strategy-specific config (dimensions setup, real-world questions) */}
          {strategy === "dimension-driven" && (
            <div>
              {dimensionsConfigured ? (
                <DimensionSummary
                  dimensions={dimensions}
                  totalQuestions={totalQuestions}
                  onEdit={onOpenWizard}
                />
              ) : (
                <button
                  onClick={onOpenWizard}
                  className="w-full py-2.5 rounded border border-dashed border-accent/30 text-xs text-accent
                             hover:bg-accent/5 hover:border-accent/50 transition-all cursor-pointer"
                >
                  Set Up Dimensions
                </button>
              )}
            </div>
          )}

          {strategy === "real-world-grounded" && (
            <div>
              {realWorldConfigured ? (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text">
                    {realWorldQuestions.length} question{realWorldQuestions.length !== 1 ? "s" : ""} loaded
                  </span>
                  <button
                    onClick={onOpenRealWorldModal}
                    className="text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenRealWorldModal}
                  className="w-full py-2.5 rounded border border-dashed border-accent/30 text-xs text-accent
                             hover:bg-accent/5 hover:border-accent/50 transition-all cursor-pointer"
                >
                  Set Up Questions
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={disabled || generating || !canGenerate}
        title={generating && disabledReason ? disabledReason : undefined}
        className={`mt-5 w-full py-3 rounded-lg font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          !(disabled || generating || !canGenerate)
            ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
            : "bg-border text-text-dim cursor-not-allowed"
        }`}
      >
        {generating ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            Generating...
          </span>
        ) : (
          "Generate Questions"
        )}
      </button>
    </div>
  );
}
