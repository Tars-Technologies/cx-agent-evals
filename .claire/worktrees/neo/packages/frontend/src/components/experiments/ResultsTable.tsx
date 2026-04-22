"use client";

import { useState } from "react";

interface RankedResult {
  experimentId: string;
  retrieverId: string | null;
  retrieverName: string;
  compositeScore: number;
  recall: number;
  precision: number;
  f1?: number;
  iou?: number;
  status: string;
}

interface ResultsTableProps {
  results: RankedResult[];
  metricNames: string[]; // which optional columns to show (f1, iou)
}

function NumericCell({ value }: { value: number | undefined }) {
  if (value === undefined) return <td className="px-3 py-2" />;
  return (
    <td
      className="px-3 py-2 text-right tabular-nums"
      style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
    >
      {(value * 100).toFixed(1)}%
    </td>
  );
}

export function ResultsTable({ results, metricNames }: ResultsTableProps) {
  const [expanded, setExpanded] = useState(false);

  const showF1 = metricNames.includes("f1");
  const showIoU = metricNames.includes("iou");

  const alwaysVisible = results.slice(0, 3);
  const hidden = results.slice(3);
  const hasHidden = hidden.length > 0;

  const visibleRows = hasHidden && !expanded ? alwaysVisible : results;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--color-border)" }}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "var(--color-bg-elevated)" }}>
              <th
                className="px-3 py-2 text-left"
                style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
              >
                Rank
              </th>
              <th
                className="px-3 py-2 text-left"
                style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
              >
                Retriever
              </th>
              <th
                className="px-3 py-2 text-right"
                style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
              >
                Recall
              </th>
              <th
                className="px-3 py-2 text-right"
                style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
              >
                Precision
              </th>
              {showF1 && (
                <th
                  className="px-3 py-2 text-right"
                  style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
                >
                  F1
                </th>
              )}
              {showIoU && (
                <th
                  className="px-3 py-2 text-right"
                  style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
                >
                  IoU
                </th>
              )}
              <th
                className="px-3 py-2 text-right"
                style={{ fontSize: "10px", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}
              >
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((result, i) => {
              const rank = i + 1;
              const isFirst = rank === 1;
              return (
                <tr
                  key={result.experimentId + (result.retrieverId ?? i)}
                  style={{ background: "var(--color-bg-surface)", borderTop: "1px solid var(--color-border)" }}
                >
                  {/* Rank */}
                  <td
                    className="px-3 py-2"
                    style={{ fontSize: "12px", color: "var(--color-text-dim)", fontWeight: 500 }}
                  >
                    #{rank}
                  </td>
                  {/* Name */}
                  <td
                    className="px-3 py-2"
                    style={{ fontSize: "12px", color: "var(--color-text)", fontWeight: 500 }}
                  >
                    {result.retrieverName}
                  </td>
                  {/* Recall */}
                  <NumericCell value={result.recall} />
                  {/* Precision */}
                  <NumericCell value={result.precision} />
                  {/* F1 */}
                  {showF1 && <NumericCell value={result.f1} />}
                  {/* IoU */}
                  {showIoU && <NumericCell value={result.iou} />}
                  {/* Score */}
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    style={{
                      fontSize: "12px",
                      color: isFirst ? "var(--color-accent)" : "var(--color-text-muted)",
                      fontWeight: isFirst ? 600 : 400,
                    }}
                  >
                    {(result.compositeScore * 100).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expand/collapse toggle */}
      {hasHidden && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="self-start"
          style={{
            fontSize: "11px",
            color: "var(--color-accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          {expanded
            ? "Show fewer retrievers"
            : `Show ${hidden.length} more retriever${hidden.length === 1 ? "" : "s"} (#4\u2013#${results.length})`}
        </button>
      )}
    </div>
  );
}
