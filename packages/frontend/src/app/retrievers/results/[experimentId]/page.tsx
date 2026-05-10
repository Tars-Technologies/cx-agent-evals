"use client";

import { use, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { SummaryBar } from "@/components/retriever-detail/SummaryBar";
import { QuestionListPane, type StatusFilter } from "@/components/retriever-detail/QuestionListPane";
import { QuestionDetailPane } from "@/components/retriever-detail/QuestionDetailPane";
import { ResizablePanel } from "@/components/ResizablePanel";
import { buildKbLink } from "@/lib/useKbFromUrl";

export default function RetrieverDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = use(params);
  const expId = experimentId as Id<"experiments">;

  const data = useQuery(api.experiments.results.getDetailForExperiment, {
    experimentId: expId,
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
    () => (filter === "all" ? sortedQuestions : sortedQuestions.filter((q) => q.status === filter)),
    [sortedQuestions, filter],
  );

  // If the selected question is filtered out, fall back to the first visible row
  const effectiveSelectedId =
    (selectedId && visibleQuestions.some((q) => q.resultId === selectedId)
      ? selectedId
      : visibleQuestions[0]?.resultId) ?? null;

  if (data === undefined) {
    return (
      <div className="flex flex-col h-screen">
        <Header mode="retrievers" />
        <div className="flex flex-1 overflow-hidden">
          <div
            className="flex-shrink-0 h-full"
            style={{ width: 360, borderRight: "1px solid var(--color-border)", background: "var(--color-bg-elevated)" }}
          >
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded animate-pulse"
                  style={{ height: 36, background: "var(--color-bg-surface)", opacity: 1 - i * 0.08 }}
                />
              ))}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex flex-col h-screen">
        <Header mode="retrievers" />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Experiment not found.
        </div>
      </div>
    );
  }

  const { experiment } = data;
  const kbId = experiment.kbId as Id<"knowledgeBases"> | null;

  // Build a back link that lands on the parent experiment-run results
  const backHref = experiment.experimentRunId
    ? buildKbLink(`/retrievers?runId=${experiment.experimentRunId}&mode=experiment`, kbId)
    : buildKbLink("/retrievers", kbId);

  // Build a small config chip from the retriever config
  const cfg = experiment.retrieverConfig as
    | { index?: { chunkSize?: number }; k?: number; search?: { embedder?: string } }
    | null;
  const configBits: string[] = [];
  if (cfg?.index?.chunkSize) configBits.push(`chunk ${cfg.index.chunkSize}`);
  if (cfg?.k) configBits.push(`k=${cfg.k}`);
  if (cfg?.search?.embedder) configBits.push(cfg.search.embedder);
  const configChip = configBits.join(" · ") || undefined;

  return (
    <div className="flex flex-col h-screen">
      <Header mode="retrievers" kbId={kbId} />
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
      <div className="flex flex-1 overflow-hidden">
        <ResizablePanel
          storageKey="retriever-detail:questions"
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
    </div>
  );
}
