// packages/frontend/src/components/GenerationBanner.tsx
"use client";

interface GenerationBannerProps {
  strategy: string;
  kbName: string;
  phase: string;
  processedItems: number;
  totalItems: number;
  questionsGenerated: number;
  onView: () => void;
}

export function GenerationBanner({
  strategy,
  kbName,
  phase,
  processedItems,
  totalItems,
  questionsGenerated,
  onView,
}: GenerationBannerProps) {
  const isPreparing = phase === "preparing";
  const progress = totalItems > 0 ? (processedItems / totalItems) * 100 : 0;

  return (
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
              <span className="text-[10px] text-text-dim">Questions:</span>
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
        <button
          onClick={onView}
          className="flex-shrink-0 ml-3 px-3 py-1 text-[10px] font-medium text-accent border border-accent/30 rounded
                     hover:bg-accent/10 transition-colors cursor-pointer"
        >
          View
        </button>
      </div>
    </div>
  );
}
