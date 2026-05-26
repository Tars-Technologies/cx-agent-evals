"use client";

import { useEffect, useRef, useState } from "react";
import { Id } from "@convex/_generated/dataModel";

interface FailureMode {
  _id: Id<"failureModes">;
  name: string;
  description: string;
  order: number;
}

interface FailureModeListPaneProps {
  failureModes: FailureMode[];
  mappingCounts: Map<string, number>;
  selectedId: Id<"failureModes"> | null;
  onSelect: (id: Id<"failureModes">) => void;
}

export function FailureModeListPane({
  failureModes,
  mappingCounts,
  selectedId,
  onSelect,
}: FailureModeListPaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const filtered = searchQuery
    ? failureModes.filter((fm) =>
        fm.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : failureModes;

  return (
    <div className="w-72 border-r border-border shrink-0 flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs text-text-dim">
          <span className="text-accent font-medium">{failureModes.length}</span>{" "}
          failure mode{failureModes.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search failure modes..."
          className="w-full px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-xs text-text-dim text-center">
            {searchQuery ? "No matches." : "No failure modes yet."}
          </div>
        ) : (
          filtered.map((fm) => {
            const isSelected = fm._id === selectedId;
            const count = mappingCounts.get(fm._id) ?? 0;

            return (
              <button
                key={fm._id}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelect(fm._id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${
                  isSelected
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-elevated border-l-2 border-l-transparent"
                }`}
              >
                <div className="text-sm text-text font-medium leading-snug line-clamp-1">
                  {fm.name}
                </div>
                <div className="text-xs text-text-dim line-clamp-1 mt-0.5">
                  {fm.description}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                    {count} question{count !== 1 ? "s" : ""}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
