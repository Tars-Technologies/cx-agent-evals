"use client"

import type { SpanLite } from "./types"

export type SpanCardKind =
  | "gold-hit" // ground-truth span that was retrieved
  | "gold-miss" // ground-truth span that was missed
  | "retrieved-hit" // retrieved span that overlaps a gold span
  | "retrieved-over" // retrieved span outside any gold span

const KIND_STYLE: Record<
  SpanCardKind,
  { border: string; bg: string; chipColor: string; chipLabel: string }
> = {
  "gold-hit": {
    border: "#22c55e",
    bg: "rgba(34,197,94,0.06)",
    chipColor: "#22c55e",
    chipLabel: "Hit"
  },
  "gold-miss": {
    border: "#ef4444",
    bg: "rgba(239,68,68,0.06)",
    chipColor: "#ef4444",
    chipLabel: "Miss"
  },
  "retrieved-hit": {
    border: "#22c55e",
    bg: "rgba(34,197,94,0.06)",
    chipColor: "#22c55e",
    chipLabel: "Hit"
  },
  "retrieved-over": {
    border: "#eab308",
    bg: "rgba(234,179,8,0.06)",
    chipColor: "#eab308",
    chipLabel: "Over"
  }
}

interface SpanCardProps {
  span: SpanLite
  kind: SpanCardKind
  rank?: number
  similarity?: number
}

export function SpanCard({ span, kind, rank, similarity }: SpanCardProps) {
  const style = KIND_STYLE[kind]
  return (
    <div
      className="rounded p-2.5 flex flex-col gap-1.5"
      style={{
        background: style.bg,
        borderStyle: "solid",
        borderColor: "var(--color-border)",
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: 3,
        borderLeftColor: style.border
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="px-1.5 py-0.5 rounded font-mono"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: style.chipColor,
              background: `${style.chipColor}1a`
            }}
          >
            {style.chipLabel}
          </span>
          <span
            className="font-mono truncate"
            style={{ fontSize: "11px", color: "var(--color-text-dim)" }}
            title={span.docId}
          >
            {span.docId}
          </span>
          <span
            className="font-mono flex-shrink-0"
            style={{ fontSize: "10px", color: "var(--color-text-muted)" }}
          >
            [{span.start}–{span.end}]
          </span>
        </div>
        {(rank !== undefined || similarity !== undefined) && (
          <span
            className="flex-shrink-0 tabular-nums"
            style={{ fontSize: "10px", color: "var(--color-text-muted)" }}
          >
            {rank !== undefined ? `#${rank}` : null}
            {rank !== undefined && similarity !== undefined ? " · " : null}
            {similarity !== undefined ? similarity.toFixed(3) : null}
          </span>
        )}
      </div>
      <div
        className="font-mono whitespace-pre-wrap break-words"
        style={{
          fontSize: "12px",
          color: "var(--color-text)",
          lineHeight: 1.5
        }}
      >
        {span.text}
      </div>
    </div>
  )
}
