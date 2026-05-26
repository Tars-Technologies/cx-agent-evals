"use client";

import Link from "next/link";

interface NotReadyStateProps {
  experimentId: string;
  annotated: number;
  total: number;
}

export function NotReadyState({
  experimentId,
  annotated,
  total,
}: NotReadyStateProps) {
  const pct = total > 0 ? Math.round((annotated / total) * 100) : 0;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-bg-elevated border border-border flex items-center justify-center">
          <svg
            className="w-6 h-6 text-text-dim"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div>
          <h3 className="text-text font-medium mb-1">
            Not enough annotations yet
          </h3>
          <p className="text-sm text-text-dim">
            Annotate at least 50% of the experiment results to generate failure
            modes. You&apos;re currently at{" "}
            <span className="text-accent font-medium">{pct}%</span> ({annotated}
            /{total}).
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <Link
          href={`/experiments/${experimentId}/annotate`}
          className="inline-block px-4 py-2 text-sm font-medium text-bg bg-accent rounded-lg hover:bg-accent-bright transition-colors"
        >
          Continue Annotating
        </Link>
      </div>
    </div>
  );
}
