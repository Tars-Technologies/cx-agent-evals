// packages/frontend/src/components/GenerationBanner.tsx
"use client";

import { useState } from "react";

interface GenerationBannerProps {
  strategy: string;
  kbName: string;
  phase: string;
  processedItems: number;
  totalItems: number;
  questionsGenerated: number;
  itemLabel?: string;
  onView: () => void;
  onCancel?: () => void;
}

export function GenerationBanner({
  strategy,
  kbName,
  phase,
  processedItems,
  totalItems,
  questionsGenerated,
  itemLabel,
  onView,
  onCancel,
}: GenerationBannerProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const isPreparing = phase === "preparing";
  const progress = totalItems > 0 ? (processedItems / totalItems) * 100 : 0;
  const label = itemLabel ?? "Questions";

  return (
    <>
      <div className="mx-4 mt-3 mb-1 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-xs text-text font-medium truncate">
                Generating: <span className="text-accent">{strategy}</span> on &ldquo;{kbName}&rdquo;
              </div>
              <div className="flex items-center gap-0 mt-1">
                <span className="text-[10px] text-text-dim">Phase:</span>
                <span className="text-[10px] text-accent-bright ml-1">{isPreparing ? "Preparing" : "Generating"}</span>
                <span className="text-[10px] text-border mx-2.5">│</span>
                <span className="text-[10px] text-text-dim">Docs:</span>
                <span className="text-[10px] text-text ml-1">
                  {isPreparing ? "—" : <>{processedItems} <span className="text-text-dim">of</span> {totalItems}</>}
                </span>
                <span className="text-[10px] text-border mx-2.5">│</span>
                <span className="text-[10px] text-text-dim">{label}:</span>
                <span className="text-[10px] text-accent ml-1">{isPreparing ? "—" : questionsGenerated}</span>
              </div>
              {!isPreparing && (
                <div className="mt-1.5 h-[2px] w-[280px] bg-border rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-sm transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center flex-shrink-0 ml-3">
            <button
              onClick={onView}
              className="px-3 py-1 text-[10px] font-medium text-accent border border-accent/30 rounded
                         hover:bg-accent/10 transition-colors cursor-pointer"
            >
              View
            </button>
            {onCancel && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="flex-shrink-0 ml-2 px-3 py-1 text-[10px] font-medium text-red-400 border border-red-400/30 rounded
                           hover:bg-red-400/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {showCancelConfirm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            className="bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-text mb-2">Cancel Simulation</h3>
            <p className="text-xs text-text-dim mb-4">
              In-progress conversations will finish, but pending ones will be stopped.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text transition-colors"
              >
                Keep Running
              </button>
              <button
                onClick={() => {
                  setShowCancelConfirm(false);
                  onCancel?.();
                }}
                className="px-4 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Cancel Simulation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
