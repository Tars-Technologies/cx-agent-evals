"use client";

import { Suspense } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useParams } from "next/navigation";
import Link from "next/link";

import { ExperimentNavSidebar } from "../_components/ExperimentNavSidebar";
import { NotReadyState } from "./_components/NotReadyState";
import { ReadyState } from "./_components/ReadyState";
import { ReviewLayout } from "./_components/ReviewLayout";

export default function FailureModesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-full">
          <Header mode="experiments" />
        </div>
      }
    >
      <FailureModesContent />
    </Suspense>
  );
}

function FailureModesContent() {
  const params = useParams();
  const experimentId = params.id as Id<"experiments">;

  const experiment = useQuery(api.experiments.orchestration.get, {
    id: experimentId,
  });
  const stats = useQuery(api.annotations.crud.stats, { experimentId });
  const failureModes = useQuery(api.failureModes.crud.byExperiment, {
    experimentId,
  });
  const mappings = useQuery(api.failureModes.crud.mappingsByExperiment, {
    experimentId,
  });
  const annotations = useQuery(api.annotations.crud.byExperiment, {
    experimentId,
  });
  const questions = useQuery(
    api.crud.questions.byDataset,
    experiment?.datasetId ? { datasetId: experiment.datasetId } : "skip",
  );

  if (!experiment || !stats) {
    return (
      <div className="flex flex-col h-full">
        <Header mode="experiments" />
        <div className="flex-1 flex items-center justify-center text-text-dim">
          Loading...
        </div>
      </div>
    );
  }

  const annotationPct =
    stats.total > 0 ? stats.annotated / stats.total : 0;
  const hasFailureModes =
    failureModes !== undefined && failureModes.length > 0;

  return (
    <div className="flex flex-col h-full">
      <Header mode="experiments" kbId={experiment.kbId ?? undefined} />

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-4">
          <Link
            href={`/experiments${experiment.kbId ? `?kb=${experiment.kbId}` : ""}`}
            className="text-text-dim hover:text-text text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <div className="text-sm font-medium text-text">
            {experiment.name}
          </div>
          <div className="text-xs text-text-dim">Failure Modes</div>
        </div>
      </div>

      {/* Sidebar + Content */}
      <div className="flex-1 overflow-hidden flex">
        <ExperimentNavSidebar />
        {annotationPct < 0.5 ? (
          <NotReadyState
            experimentId={experimentId}
            annotated={stats.annotated}
            total={stats.total}
          />
        ) : !hasFailureModes ? (
          <ReadyState
            experimentId={experimentId}
            annotated={stats.annotated}
            total={stats.total}
          />
        ) : (
          <ReviewLayout
            failureModes={failureModes}
            mappings={(mappings ?? []) as any}
            questions={(questions ?? []) as any}
            annotations={(annotations ?? []) as any}
            experimentId={experimentId}
          />
        )}
      </div>
    </div>
  );
}
