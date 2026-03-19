"use client";

interface StatusBadgeProps {
  status: "available" | "coming-soon";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === "available") {
    return null;
  }

  return (
    <span className="text-text-dim bg-bg-hover text-xs px-1.5 py-0.5 rounded">
      Coming soon
    </span>
  );
}
