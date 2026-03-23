// packages/frontend/src/components/GenerationBanner.tsx
"use client";

interface GenerationBannerProps {
  strategy: string;
  kbName: string;
  phase: string;
  processedItems: number;
  totalItems: number;
  onView: () => void;
}

export function GenerationBanner({
  strategy,
  kbName,
  phase,
  processedItems,
  totalItems,
  onView,
}: GenerationBannerProps) {
  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text font-medium truncate">
              Generating: <span className="text-accent">{strategy}</span> on &ldquo;{kbName}&rdquo;
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Phase: {phase} ({processedItems}/{totalItems} items)
            </div>
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
