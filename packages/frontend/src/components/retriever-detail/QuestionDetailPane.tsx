"use client";

import type { DetailQuestionRow, SpanLite } from "./types";
import { SpanCard, type SpanCardKind } from "./SpanCard";

interface QuestionDetailPaneProps {
  question: DetailQuestionRow | null;
  metricNames: string[];
}

function MetricChip({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded"
      style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <span style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </span>
      <span className="tabular-nums" style={{ fontSize: "12px", color: "var(--color-text)", fontWeight: 600 }}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function spansOverlap(a: SpanLite, b: SpanLite): boolean {
  return a.docId === b.docId && a.start < b.end && b.start < a.end;
}

function classifyGold(span: SpanLite, retrieved: SpanLite[]): SpanCardKind {
  return retrieved.some((r) => spansOverlap(span, r)) ? "gold-hit" : "gold-miss";
}

function classifyRetrieved(span: SpanLite, gold: SpanLite[]): SpanCardKind {
  return gold.some((g) => spansOverlap(span, g)) ? "retrieved-hit" : "retrieved-over";
}

export function QuestionDetailPane({ question, metricNames }: QuestionDetailPaneProps) {
  if (!question) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
        Select a question on the left.
      </div>
    );
  }

  const showF1 = metricNames.includes("f1");
  const showIoU = metricNames.includes("iou");

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Question header */}
      <div className="px-6 py-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Question
        </span>
        <p style={{ fontSize: "14px", color: "var(--color-text)", lineHeight: 1.5 }}>
          {question.queryText}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <MetricChip label="Recall" value={question.scores.recall} />
          <MetricChip label="Precision" value={question.scores.precision} />
          {showF1 && <MetricChip label="F1" value={question.scores.f1} />}
          {showIoU && <MetricChip label="IoU" value={question.scores.iou} />}
        </div>
      </div>

      {/* Diff body — two columns */}
      <div className="flex-1 grid grid-cols-2 gap-4 p-6">
        {/* Ground truth */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 sticky top-0 pb-2" style={{ background: "var(--color-bg)", zIndex: 1 }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Ground truth
            </span>
            <span className="tabular-nums" style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {question.goldSpans.length} span{question.goldSpans.length === 1 ? "" : "s"}
            </span>
          </div>
          {question.goldSpans.length === 0 ? (
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>No ground-truth spans.</span>
          ) : (
            question.goldSpans.map((span, i) => (
              <SpanCard
                key={`gold-${i}`}
                span={span}
                kind={classifyGold(span, question.retrievedSpans)}
              />
            ))
          )}
        </div>

        {/* Retrieved */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 sticky top-0 pb-2" style={{ background: "var(--color-bg)", zIndex: 1 }}>
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Retrieved
            </span>
            <span className="tabular-nums" style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {question.retrievedSpans.length} span{question.retrievedSpans.length === 1 ? "" : "s"}
            </span>
          </div>
          {question.retrievedSpans.length === 0 ? (
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>No retrieved spans.</span>
          ) : (
            question.retrievedSpans.map((span, i) => (
              <SpanCard
                key={`ret-${i}`}
                span={span}
                kind={classifyRetrieved(span, question.goldSpans)}
                rank={i + 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
