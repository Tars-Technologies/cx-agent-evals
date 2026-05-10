"use client";

import { use, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { SummaryBar } from "@/components/retriever-detail/SummaryBar";
import { QuestionListPane } from "@/components/retriever-detail/QuestionListPane";
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
  const effectiveSelectedId =
    selectedId ?? (sortedQuestions[0]?.resultId ?? null);

  if (data === undefined) {
    return (
      <div className="flex flex-col h-screen">
        <Header mode="retrievers" />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Loading…
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
          />
        </ResizablePanel>
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          {effectiveSelectedId
            ? "Diff view coming next."
            : "Select a question on the left."}
        </div>
      </div>
    </div>
  );
}
