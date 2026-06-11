"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ErrorAnalysisCard } from "@/components/errorAnalysis/ErrorAnalysisCard";
import { CreateCustomCohortModal } from "@/components/errorAnalysis/CreateCustomCohortModal";

export default function ErrorAnalysisLanding() {
  const { id } = useParams<{ id: string }>();
  const agentId = id as Id<"agents">;
  const router = useRouter();
  const analyses = useQuery(api.errorAnalysis.orchestration.byAgent, { agentId });
  const [createOpen, setCreateOpen] = useState(false);

  const list = analyses ?? [];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium text-text">Error analysis</h1>
          {analyses !== undefined && (
            <span className="text-[11px] text-text-dim">
              {list.length} {list.length === 1 ? "analysis" : "analyses"}
            </span>
          )}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          + New analysis
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {analyses === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No error analyses yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &lsquo;+ New analysis&rsquo; to create a custom cohort to annotate.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((a) => (
              <ErrorAnalysisCard
                key={a._id}
                analysis={a}
                onClick={() =>
                  router.push(
                    `/agents/${agentId}/evaluate/error-analysis/${a._id}/annotate`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <CreateCustomCohortModal
        agentId={agentId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(newId) =>
          router.push(
            `/agents/${agentId}/evaluate/error-analysis/${newId}/annotate`,
          )
        }
      />
    </div>
  );
}
