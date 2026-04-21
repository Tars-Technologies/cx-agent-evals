"use client";

interface RankedResult {
  experimentId: string;
  retrieverId: string | undefined;
  retrieverName: string;
  compositeScore: number;
  recall: number;
  precision: number;
  f1?: number;
  iou?: number;
  status: string;
}

interface PodiumViewProps {
  results: RankedResult[]; // already sorted by compositeScore desc
  formula: string; // e.g., "0.7 × Recall + 0.3 × Precision"
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span style={{ fontSize: "10px" }} className="text-text-muted uppercase tracking-wide">
        {label}
      </span>
      <span style={{ fontSize: "11px" }} className="text-text-dim font-medium tabular-nums">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function FirstPlaceCard({ result }: { result: RankedResult }) {
  return (
    <div className="flex flex-col items-stretch" style={{ flex: "0 0 160px" }}>
      {/* Card */}
      <div
        className="rounded-t-lg p-3 flex flex-col gap-2"
        style={{
          border: "1px solid rgba(110,231,183,0.3)",
          borderBottom: "none",
          background: "linear-gradient(135deg, rgba(110,231,183,0.08) 0%, rgba(110,231,183,0.03) 100%)",
        }}
      >
        <div
          style={{ fontSize: "10px", color: "#fbbf24", fontWeight: 600, letterSpacing: "0.05em" }}
          className="uppercase"
        >
          ★ 1st
        </div>
        <div
          style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-accent-bright)" }}
          className="leading-tight break-words"
        >
          {result.retrieverName}
        </div>
        <div
          style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-accent)", lineHeight: 1 }}
          className="tabular-nums"
        >
          {(result.compositeScore * 100).toFixed(1)}%
        </div>
        <div className="flex flex-col gap-1 mt-1">
          <MetricRow label="Recall" value={result.recall} />
          <MetricRow label="Precision" value={result.precision} />
        </div>
      </div>
      {/* Pedestal */}
      <div
        style={{
          height: "72px",
          background: "linear-gradient(180deg, rgba(110,231,183,0.2) 0%, rgba(110,231,183,0.05) 100%)",
          border: "1px solid rgba(110,231,183,0.3)",
          borderTop: "none",
        }}
      />
    </div>
  );
}

function SecondPlaceCard({ result }: { result: RankedResult }) {
  return (
    <div className="flex flex-col items-stretch" style={{ flex: "0 0 140px" }}>
      {/* Card */}
      <div
        className="rounded-t-lg p-3 flex flex-col gap-2"
        style={{
          border: "1px solid rgba(148,163,184,0.2)",
          borderBottom: "none",
          background: "transparent",
        }}
      >
        <div
          style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}
          className="uppercase"
        >
          2nd
        </div>
        <div
          style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text)" }}
          className="leading-tight break-words"
        >
          {result.retrieverName}
        </div>
        <div
          style={{ fontSize: "24px", fontWeight: 600, color: "var(--color-text)", lineHeight: 1 }}
          className="tabular-nums"
        >
          {(result.compositeScore * 100).toFixed(1)}%
        </div>
        <div className="flex flex-col gap-1 mt-1">
          <MetricRow label="Recall" value={result.recall} />
          <MetricRow label="Precision" value={result.precision} />
        </div>
      </div>
      {/* Pedestal */}
      <div
        style={{
          height: "52px",
          background: "linear-gradient(180deg, rgba(148,163,184,0.15) 0%, rgba(148,163,184,0.04) 100%)",
          border: "1px solid rgba(148,163,184,0.2)",
          borderTop: "none",
        }}
      />
    </div>
  );
}

function ThirdPlaceCard({ result }: { result: RankedResult }) {
  return (
    <div className="flex flex-col items-stretch" style={{ flex: "0 0 140px" }}>
      {/* Card */}
      <div
        className="rounded-t-lg p-3 flex flex-col gap-2"
        style={{
          border: "1px solid rgba(217,119,6,0.2)",
          borderBottom: "none",
          background: "transparent",
        }}
      >
        <div
          style={{ fontSize: "10px", color: "#d97706", fontWeight: 600, letterSpacing: "0.05em" }}
          className="uppercase"
        >
          3rd
        </div>
        <div
          style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text)" }}
          className="leading-tight break-words"
        >
          {result.retrieverName}
        </div>
        <div
          style={{ fontSize: "24px", fontWeight: 600, color: "var(--color-text)", lineHeight: 1 }}
          className="tabular-nums"
        >
          {(result.compositeScore * 100).toFixed(1)}%
        </div>
        <div className="flex flex-col gap-1 mt-1">
          <MetricRow label="Recall" value={result.recall} />
          <MetricRow label="Precision" value={result.precision} />
        </div>
      </div>
      {/* Pedestal */}
      <div
        style={{
          height: "36px",
          background: "linear-gradient(180deg, rgba(217,119,6,0.15) 0%, rgba(217,119,6,0.04) 100%)",
          border: "1px solid rgba(217,119,6,0.2)",
          borderTop: "none",
        }}
      />
    </div>
  );
}

export function PodiumView({ results, formula }: PodiumViewProps) {
  const first = results[0];
  const second = results[1];
  const third = results[2];

  if (!first || !second || !third) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Podium */}
      <div className="flex items-end justify-center gap-2">
        {/* 2nd place — left */}
        <SecondPlaceCard result={second} />
        {/* 1st place — center */}
        <FirstPlaceCard result={first} />
        {/* 3rd place — right */}
        <ThirdPlaceCard result={third} />
      </div>
      {/* Formula note */}
      <div style={{ fontSize: "10px" }} className="text-text-muted text-center">
        Ranked by{" "}
        <span className="font-mono text-text-dim">
          Score = {formula}
        </span>
      </div>
    </div>
  );
}
