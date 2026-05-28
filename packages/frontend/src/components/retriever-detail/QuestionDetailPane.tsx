"use client"

import { useMemo } from "react"
import { SpanCard, type SpanCardKind } from "./SpanCard"
import type { DetailQuestionRow, SpanLite } from "./types"
import { buildDiffRows, type RetrievedWithRank } from "./useSpanDiff"

interface QuestionDetailPaneProps {
  question: DetailQuestionRow | null
  metricNames: string[]
}

function MetricChip({
  label,
  value
}: {
  label: string
  value: number | undefined
}) {
  if (value === undefined) return null
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded"
      style={{
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-border)"
      }}
    >
      <span
        style={{
          fontSize: "10px",
          color: "var(--color-text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontSize: "12px",
          color: "var(--color-text)",
          fontWeight: 600
        }}
      >
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

function spansOverlap(a: SpanLite, b: SpanLite): boolean {
  return a.docId === b.docId && a.start < b.end && b.start < a.end
}

function classifyGold(span: SpanLite, retrieved: SpanLite[]): SpanCardKind {
  return retrieved.some((r) => spansOverlap(span, r)) ? "gold-hit" : "gold-miss"
}

function classifyRetrieved(span: SpanLite, gold: SpanLite[]): SpanCardKind {
  return gold.some((g) => spansOverlap(span, g))
    ? "retrieved-hit"
    : "retrieved-over"
}

function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      className="flex items-center gap-2 px-6 py-2 sticky top-0 z-10"
      style={{
        background: "var(--color-bg)",
        borderBottom: "1px solid var(--color-border)"
      }}
    >
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--color-text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{ fontSize: "11px", color: "var(--color-text-muted)" }}
      >
        {count} span{count === 1 ? "" : "s"}
      </span>
    </div>
  )
}

export function QuestionDetailPane({
  question,
  metricNames
}: QuestionDetailPaneProps) {
  const rows = useMemo(
    () =>
      question
        ? buildDiffRows(question.goldSpans, question.retrievedSpans)
        : [],
    [question]
  )

  if (!question) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ fontSize: "13px", color: "var(--color-text-muted)" }}
      >
        Select a question on the left.
      </div>
    )
  }

  const showF1 = metricNames.includes("f1")
  const showIoU = metricNames.includes("iou")

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Question header */}
      <div
        className="px-6 py-4 flex flex-col gap-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.05em"
          }}
        >
          Question
        </span>
        <p
          style={{
            fontSize: "14px",
            color: "var(--color-text)",
            lineHeight: 1.5
          }}
        >
          {question.queryText}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <MetricChip label="Recall" value={question.scores.recall} />
          <MetricChip label="Precision" value={question.scores.precision} />
          {showF1 && <MetricChip label="F1" value={question.scores.f1} />}
          {showIoU && <MetricChip label="IoU" value={question.scores.iou} />}
        </div>
      </div>

      {/* Row-aligned diff body */}
      <div className="grid grid-cols-2">
        <ColumnHeader label="Ground truth" count={question.goldSpans.length} />
        <ColumnHeader
          label="Retrieved"
          count={question.retrievedSpans.length}
        />

        {rows.length === 0 ? (
          <div
            className="col-span-2 px-6 py-6 text-center"
            style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
          >
            No spans to compare.
          </div>
        ) : (
          rows.map((row, i) => (
            <DiffRowCells
              key={i}
              row={row}
              allGold={question.goldSpans}
              allRetrieved={question.retrievedSpans}
              isLast={i === rows.length - 1}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DiffRowCells({
  row,
  allGold,
  allRetrieved,
  isLast
}: {
  row: { gold: SpanLite[]; retrieved: RetrievedWithRank[] }
  allGold: SpanLite[]
  allRetrieved: SpanLite[]
  isLast: boolean
}) {
  const cellStyle: React.CSSProperties = {
    padding: "12px 24px",
    borderBottom: isLast ? "none" : "1px solid var(--color-border)"
  }
  return (
    <>
      <div
        className="flex flex-col gap-2"
        style={{ ...cellStyle, borderRight: "1px solid var(--color-border)" }}
      >
        {row.gold.length === 0 ? (
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-text-dim)",
              fontStyle: "italic"
            }}
          >
            (no gold span)
          </span>
        ) : (
          row.gold.map((span, i) => (
            <SpanCard
              key={`g-${i}`}
              span={span}
              kind={classifyGold(span, allRetrieved)}
            />
          ))
        )}
      </div>
      <div className="flex flex-col gap-2" style={cellStyle}>
        {row.retrieved.length === 0 ? (
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-text-dim)",
              fontStyle: "italic"
            }}
          >
            (no retrieved span)
          </span>
        ) : (
          row.retrieved.map((span) => (
            <SpanCard
              key={`r-${span.rank}`}
              span={span}
              kind={classifyRetrieved(span, allGold)}
              rank={span.rank}
            />
          ))
        )}
      </div>
    </>
  )
}
