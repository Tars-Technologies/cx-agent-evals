"use client";

import { useState } from "react";
import { MarkdownViewer } from "./MarkdownViewer";

interface ChunkCardProps {
  rank: number;
  score: number;
  docId?: string;
  start?: number;
  end?: number;
  content: string;
  metadata?: Record<string, unknown>;
  /** Default collapsed (3-line clamp). Click to expand. */
  defaultExpanded?: boolean;
}

function formatHeader(
  rank: number,
  score: number,
  docId?: string,
  start?: number,
  end?: number,
): string {
  let header = `#${rank} · score: ${score.toFixed(2)}`;
  if (docId != null) {
    header += ` · ${docId}`;
  }
  if (start != null && end != null) {
    header += ` (${start}–${end})`;
  }
  return header;
}

export function ChunkCard({
  rank,
  score,
  docId,
  start,
  end,
  content,
  defaultExpanded = false,
}: ChunkCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((prev) => !prev);
        }
      }}
      className="bg-elevated border border-border rounded-lg p-3 cursor-pointer hover:border-accent/30 transition-colors"
    >
      <p className="text-[11px] text-dim font-mono mb-2 select-none">
        {formatHeader(rank, score, docId, start, end)}
      </p>

      <div className="relative">
        <div
          className={
            expanded
              ? ""
              : "max-h-[4.5rem] overflow-hidden"
          }
        >
          {/* Stop click on the toggle pill from toggling the card */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div onClick={(e) => e.stopPropagation()}>
            <MarkdownViewer
              content={content}
              showToggle={true}
              defaultMode="rendered"
            />
          </div>
        </div>

        {/* Gradient fade overlay when collapsed */}
        {!expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-elevated to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
}
