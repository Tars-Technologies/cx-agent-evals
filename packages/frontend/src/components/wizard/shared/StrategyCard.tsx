"use client";

import type { ReactNode } from "react";
import { StatusBadge } from "./StatusBadge";

interface StrategyCardProps {
  id: string;
  name: string;
  description: string;
  status: "available" | "coming-soon";
  selected: boolean;
  onSelect: (id: string) => void;
  tags?: readonly string[];
  badge?: ReactNode;
}

export function StrategyCard({
  id,
  name,
  description,
  status,
  selected,
  onSelect,
  tags,
  badge,
}: StrategyCardProps) {
  const isDisabled = status === "coming-soon";

  const handleClick = () => {
    if (!isDisabled) {
      onSelect(id);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={`
        relative w-full text-left p-3 rounded-lg border
        transition-all duration-150
        ${isDisabled
          ? "opacity-50 cursor-not-allowed border-border bg-bg-surface"
          : selected
            ? "border-accent bg-accent-dim/10"
            : "border-border bg-bg-surface hover:bg-bg-hover hover:border-border-bright cursor-pointer"
        }
      `}
    >
      {/* Header row: name + badges */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text">{name}</span>
        {badge}
        <StatusBadge status={status} />
      </div>

      {/* Description */}
      <p className="mt-1 text-xs text-text-muted leading-relaxed">
        {description}
      </p>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Selection indicator */}
      {selected && (
        <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-accent" />
      )}
    </button>
  );
}
