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

interface SoloScoreCardProps {
  result: RankedResult;
  formula: string;
}

export function SoloScoreCard({ result, formula }: SoloScoreCardProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Card */}
      <div
        className="rounded-lg p-5 flex flex-col items-center gap-3"
        style={{
          maxWidth: "360px",
          width: "100%",
          border: "1px solid rgba(110,231,183,0.3)",
          background: "linear-gradient(135deg, rgba(110,231,183,0.08) 0%, rgba(110,231,183,0.03) 100%)",
        }}
      >
        {/* Label */}
        <div
          style={{ fontSize: "10px", color: "#fbbf24", fontWeight: 600, letterSpacing: "0.08em" }}
          className="uppercase text-center"
        >
          Retriever Score
        </div>

        {/* Name */}
        <div
          style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-accent-bright)" }}
          className="text-center leading-tight"
        >
          {result.retrieverName}
        </div>

        {/* Score */}
        <div
          style={{ fontSize: "36px", fontWeight: 700, color: "var(--color-accent)", lineHeight: 1 }}
          className="tabular-nums text-center"
        >
          {(result.compositeScore * 100).toFixed(1)}%
        </div>

        {/* Metrics */}
        <div className="flex flex-col gap-1 w-full mt-1">
          <div className="flex justify-between items-center gap-2">
            <span style={{ fontSize: "10px" }} className="text-text-muted uppercase tracking-wide">
              Recall
            </span>
            <span style={{ fontSize: "11px" }} className="text-text-dim font-medium tabular-nums">
              {(result.recall * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span style={{ fontSize: "10px" }} className="text-text-muted uppercase tracking-wide">
              Precision
            </span>
            <span style={{ fontSize: "11px" }} className="text-text-dim font-medium tabular-nums">
              {(result.precision * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Hint */}
      <div style={{ fontSize: "11px" }} className="text-text-muted text-center italic">
        Add more retrievers to see comparative rankings.
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
