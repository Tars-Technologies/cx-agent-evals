"use client";

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <span className="relative inline-flex group cursor-help">
      <span className="text-text-dim text-xs">(i)</span>
      <span
        className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
          hidden group-hover:block
          bg-bg-elevated border border-border text-text text-xs
          p-2 rounded whitespace-pre-wrap
          max-w-56 w-max z-10
        "
      >
        {text}
      </span>
    </span>
  );
}
