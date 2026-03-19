"use client";

interface ComplexityBadgeProps {
  complexity: "basic" | "intermediate" | "advanced";
}

const COMPLEXITY_STYLES: Record<
  ComplexityBadgeProps["complexity"],
  string
> = {
  basic: "text-accent bg-accent/10 border-accent/20",
  intermediate: "text-warn bg-warn/10 border-warn/20",
  advanced: "text-error bg-error/10 border-error/20",
};

export function ComplexityBadge({ complexity }: ComplexityBadgeProps) {
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border ${COMPLEXITY_STYLES[complexity]}`}
    >
      {complexity}
    </span>
  );
}
