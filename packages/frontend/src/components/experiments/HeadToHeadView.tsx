"use client";

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

interface HeadToHeadViewProps {
  winner: RankedResult;
  loser: RankedResult;
  formula: string;
}

function MetricRow({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span style={{ fontSize: "10px" }} className="text-text-muted uppercase tracking-wide">
        {label}
      </span>
      <span
        style={{ fontSize: "11px" }}
        className={`font-medium tabular-nums ${dim ? "text-text-muted" : "text-text-dim"}`}
      >
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

export function HeadToHeadView({ winner, loser, formula }: HeadToHeadViewProps) {
  const delta = ((winner.compositeScore - loser.compositeScore) * 100).toFixed(1);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Cards row */}
      <div
        className="flex items-stretch gap-4"
        style={{ maxWidth: "560px", width: "100%", margin: "0 auto" }}
      >
        {/* Winner card */}
        <div
          className="flex-1 rounded-lg p-4 flex flex-col gap-2"
          style={{
            border: "1px solid rgba(110,231,183,0.3)",
            background: "linear-gradient(135deg, rgba(110,231,183,0.08) 0%, rgba(110,231,183,0.03) 100%)",
          }}
        >
          <div
            style={{ fontSize: "10px", color: "#fbbf24", fontWeight: 600, letterSpacing: "0.05em" }}
            className="uppercase"
          >
            ★ Winner
          </div>
          <div
            style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-accent-bright)" }}
            className="leading-tight"
          >
            {winner.retrieverName}
          </div>
          <div
            style={{ fontSize: "30px", fontWeight: 700, color: "var(--color-accent)", lineHeight: 1 }}
            className="tabular-nums"
          >
            {(winner.compositeScore * 100).toFixed(1)}%
          </div>
          {/* Delta badge */}
          <div
            className="inline-flex items-center self-start px-2 py-0.5 rounded"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--color-accent)",
              background: "rgba(110,231,183,0.1)",
            }}
          >
            +{delta}% ahead
          </div>
          <div className="flex flex-col gap-1 mt-1">
            <MetricRow label="Recall" value={winner.recall} />
            <MetricRow label="Precision" value={winner.precision} />
          </div>
        </div>

        {/* vs divider */}
        <div
          className="flex items-center justify-center"
          style={{ width: "32px", fontSize: "12px", fontWeight: 700, color: "var(--color-text-dim)" }}
        >
          vs
        </div>

        {/* Loser card */}
        <div
          className="flex-1 rounded-lg p-4 flex flex-col gap-2"
          style={{
            border: "1px solid var(--color-border)",
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
            style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}
            className="leading-tight"
          >
            {loser.retrieverName}
          </div>
          <div
            style={{ fontSize: "30px", fontWeight: 600, color: "var(--color-text-muted)", lineHeight: 1 }}
            className="tabular-nums"
          >
            {(loser.compositeScore * 100).toFixed(1)}%
          </div>
          <div className="flex flex-col gap-1 mt-4">
            <MetricRow label="Recall" value={loser.recall} dim />
            <MetricRow label="Precision" value={loser.precision} dim />
          </div>
        </div>
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
