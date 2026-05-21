"use client";

import { use, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { Spinner } from "@/components/shell/Spinner";
import { kbSidebar } from "@/components/shell/sidebars";
import { useKbBreadcrumb } from "@/lib/useKbBreadcrumb";
import { SummaryBar } from "@/components/retriever-detail/SummaryBar";
import { QuestionListPane, type StatusFilter } from "@/components/retriever-detail/QuestionListPane";
import { QuestionDetailPane } from "@/components/retriever-detail/QuestionDetailPane";
import { ResizablePanel } from "@/components/ResizablePanel";

export default function KbExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string; expId: string }>;
}) {
  const { id, expId } = use(params);
  const kbId = id as Id<"knowledgeBases">;
  const experimentId = expId as Id<"experiments">;

  const { labelOverrides: kbLabelOverrides } = useKbBreadcrumb(kbId);
  const data = useQuery(api.experiments.results.getDetailForExperiment, {
    experimentId,
  });

  const sortedQuestions = useMemo(() => {
    if (!data) return [];
    return [...data.questions].sort(
      (a, b) => (a.scores.recall ?? 0) - (b.scores.recall ?? 0),
    );
  }, [data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const visibleQuestions = useMemo(
    () =>
      filter === "all"
        ? sortedQuestions
        : sortedQuestions.filter((q) => q.status === filter),
    [sortedQuestions, filter],
  );

  const effectiveSelectedId =
    (selectedId && visibleQuestions.some((q) => q.resultId === selectedId)
      ? selectedId
      : visibleQuestions[0]?.resultId) ?? null;

  const breadcrumbLabelOverrides = data?.experiment?.name
    ? { ...(kbLabelOverrides ?? {}), [experimentId]: data.experiment.name }
    : kbLabelOverrides;

  if (data === undefined) {
    return (
      <EntityDetailLayout
        sidebarTitle="Knowledge Base"
        sidebar={kbSidebar(kbId)}
        breadcrumbLabelOverrides={breadcrumbLabelOverrides}
      >
        <Spinner label="Loading…" />
      </EntityDetailLayout>
    );
  }

  if (data === null) {
    return (
      <EntityDetailLayout
        sidebarTitle="Knowledge Base"
        sidebar={kbSidebar(kbId)}
        breadcrumbLabelOverrides={breadcrumbLabelOverrides}
      >
        <div className="text-text-muted text-sm">Experiment not found.</div>
      </EntityDetailLayout>
    );
  }

  const { experiment } = data;
  const backHref = experiment.experimentRunId
    ? `/kb/${kbId}/evaluate/experiments?runId=${experiment.experimentRunId}`
    : `/kb/${kbId}/evaluate/experiments`;

  const cfg = experiment.retrieverConfig as
    | { index?: { chunkSize?: number }; k?: number; search?: { embedder?: string } }
    | null;
  const configBits: string[] = [];
  if (cfg?.index?.chunkSize) configBits.push(`chunk ${cfg.index.chunkSize}`);
  if (cfg?.k) configBits.push(`k=${cfg.k}`);
  if (cfg?.search?.embedder) configBits.push(cfg.search.embedder);
  const configChip = configBits.join(" · ") || undefined;

  return (
    <EntityDetailLayout
      sidebarTitle="Knowledge Base"
      sidebar={kbSidebar(kbId)}
      breadcrumbLabelOverrides={breadcrumbLabelOverrides}
      fullWidth
    >
      <SummaryBar
        retrieverName={experiment.retrieverName}
        experimentName={experiment.name}
        datasetName={experiment.datasetName}
        questionCount={data.questions.length}
        scores={experiment.scores as Record<string, number>}
        metricNames={experiment.metricNames}
        backHref={backHref}
        configChip={configChip}
        status={experiment.status}
        phase={experiment.phase}
        totalQuestions={experiment.totalQuestions}
        processedQuestions={experiment.processedQuestions}
      />
      <div className="flex border border-border rounded-lg overflow-hidden bg-bg-elevated mt-3 flex-1 min-h-0">
        <ResizablePanel
          storageKey="kb-experiment-detail:questions"
          defaultWidth={360}
          minWidth={260}
          maxWidth={520}
          className="h-full"
        >
          <QuestionListPane
            questions={sortedQuestions}
            selectedId={effectiveSelectedId}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
          />
        </ResizablePanel>
        {sortedQuestions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center" style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            {experiment.status === "running" || experiment.status === "pending"
              ? "Evaluating… results will stream in here."
              : "No results."}
          </div>
        ) : (
          <QuestionDetailPane
            question={
              visibleQuestions.find((q) => q.resultId === effectiveSelectedId) ?? null
            }
            metricNames={experiment.metricNames}
          />
        )}
      </div>
    </EntityDetailLayout>
  );
}
