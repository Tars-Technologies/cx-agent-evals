"use client";

import { useState, useRef, useEffect } from "react";

const CATEGORY_COLORS: Record<string, string> = {
  question: "bg-[#22d3ee]",
  request: "bg-[#818cf8]",
  identity_info: "bg-[#fbbf24]",
  confirmation: "bg-[#8888a0]",
  greeting: "bg-[#6ee7b7]",
  closing: "bg-[#c084fc]",
  uncategorized: "bg-[#55556a]",
  other: "bg-[#55556a]",
};

export function LabelEditDropdown({
  currentLabel,
  categories,
  onSelect,
}: {
  currentLabel: string;
  categories: string[];
  onSelect: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[9px] px-1.5 py-0 rounded border border-transparent hover:border-border-bright cursor-pointer"
      >
        {currentLabel}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border-bright rounded-md p-0.5 min-w-[120px] shadow-lg">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => { onSelect(cat); setOpen(false); }}
              className={`w-full text-left px-2 py-1 rounded text-[9px] flex items-center gap-1.5 ${
                cat === currentLabel ? "text-accent" : "text-text-muted hover:bg-bg-hover hover:text-text"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_COLORS[cat] ?? "bg-text-dim"}`} />
              {cat}
              {cat === currentLabel && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
