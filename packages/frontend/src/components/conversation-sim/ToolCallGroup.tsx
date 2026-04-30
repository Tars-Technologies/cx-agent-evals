"use client";

import { useState } from "react";
import ToolCallChip from "@/components/ToolCallChip";
import type { ToolCallEntry } from "@/lib/messageDisplay";

export function ToolCallGroup({ calls, isLive }: {
  calls: ToolCallEntry[];
  isLive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const allDone = calls.every((c) => c.toolResult !== undefined);
  const lastCall = calls[calls.length - 1];
  const displayName = (name: string) =>
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-[10px] hover:border-accent/30 transition-colors"
        >
          <span className="text-accent">⚡</span>
          {isLive && !allDone ? (
            <span className="text-text-muted">
              Calling <strong className="text-text font-medium">{displayName(lastCall.toolName)}</strong>
              <span className="inline-block w-1 h-1 bg-accent rounded-full ml-1 animate-pulse align-middle" />
            </span>
          ) : (
            <span className="text-text-muted">
              <strong className="text-text font-medium">{calls.length}</strong> tool{calls.length !== 1 ? "s" : ""} called
            </span>
          )}
          <span className="text-text-dim ml-0.5">{expanded ? "▾" : "▸"}</span>
        </button>

        {expanded && (
          <div className="mt-1 ml-2 space-y-1">
            {calls.map((call, i) => (
              <ToolCallChip
                key={i}
                toolName={call.toolName}
                toolArgs={call.toolArgs}
                toolResult={call.toolResult}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
