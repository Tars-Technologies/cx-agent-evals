"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ResizablePanes } from "./ResizablePanes";
import { ExperimentRunsSidebar } from "./ExperimentRunsSidebar";
import { ExperimentQuestionList } from "./ExperimentQuestionList";
import { ExperimentAnnotationPane } from "./ExperimentAnnotationPane";
import { ExperimentMetadataPane } from "./ExperimentMetadataPane";
import { CreateAgentExperimentModal } from "./CreateAgentExperimentModal";

function LiveBanner({ experiment, onCancel }: { experiment: any; onCancel: () => void }) {
  const progress = experiment.totalQuestions
    ? ((experiment.processedQuestions ?? 0) / experiment.totalQuestions) * 100
    : 0;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-950/30 border-b border-yellow-800">
      <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
      <span className="text-yellow-400 text-xs">Experiment running</span>
      <span className="text-text-dim text-xs">
        {experiment.processedQuestions ?? 0} / {experiment.totalQuestions ?? "?"} questions
      </span>
      <div className="flex-1 h-1 bg-yellow-950 rounded-full ml-2">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <button
        onClick={onCancel}
        className="px-2 py-0.5 bg-red-950 border border-red-500 rounded text-red-400 text-xs hover:bg-red-900"
      >
        Cancel
      </button>
    </div>
  );
}

interface ExperimentModeLayoutProps {
  selectedRunId: Id<"experiments"> | null;
  onSelectRun: (id: Id<"experiments"> | null) => void;
  showCreateModal: boolean;
  onCloseCreateModal: () => void;
  onCreated: (id: Id<"experiments">) => void;
}

export function ExperimentModeLayout({
  selectedRunId,
  onSelectRun,
  showCreateModal,
  onCloseCreateModal,
  onCreated,
}: ExperimentModeLayoutProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<Id<"questions"> | null>(null);
  const [runsCollapsed, setRunsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return JSON.parse(localStorage.getItem("agents-experiment-runs-collapsed") ?? "false");
    } catch {
      return false;
    }
  });
  const [comment, setComment] = useState("");

  // Reset question selection on run change
  useEffect(() => {
    setSelectedQuestionId(null);
  }, [selectedRunId]);

  // Queries
  const experiments = useQuery(api.experiments.orchestration.byOrg);
  const agentExperiments = useMemo(
    () => experiments?.filter((e: any) => e.experimentType === "agent") ?? [],
    [experiments],
  );

  const selectedExperiment = useQuery(
    api.experiments.orchestration.get,
    selectedRunId ? { id: selectedRunId } : "skip",
  );

  const results = useQuery(
    api.experiments.agentResults.byExperiment,
    selectedRunId ? { experimentId: selectedRunId } : "skip",
  );

  const annotations = useQuery(
    api.annotations.crud.byExperiment,
    selectedRunId ? { experimentId: selectedRunId } : "skip",
  );

  const annotationStats = useQuery(
    api.annotations.crud.stats,
    selectedRunId ? { experimentId: selectedRunId } : "skip",
  );

  const allTags =
    useQuery(
      api.annotations.crud.allTags,
      selectedRunId ? { experimentId: selectedRunId } : "skip",
    ) ?? [];

  const questions = useQuery(
    api.crud.questions.byDataset,
    selectedExperiment?.datasetId ? { datasetId: selectedExperiment.datasetId } : "skip",
  );

  // Derived state
  const annotationMap = useMemo(() => {
    const map = new Map();
    annotations?.forEach((a: any) => map.set(a.resultId.toString(), a));
    return map;
  }, [annotations]);

  const resultMap = useMemo(() => {
    const map = new Map();
    results?.forEach((r: any) => map.set(r.questionId.toString(), r));
    return map;
  }, [results]);

  const questionItems = useMemo(() => {
    if (!questions) return [];
    return questions.map((q: any) => {
      const result = resultMap.get(q._id.toString());
      const annotation = result ? annotationMap.get(result._id.toString()) : null;
      return {
        questionId: q._id,
        queryText: q.queryText,
        resultId: result?._id ?? null,
        rating: annotation?.rating ?? null,
        hasComment: !!annotation?.comment,
      };
    });
  }, [questions, resultMap, annotationMap]);

  const currentItem = selectedQuestionId
    ? questionItems.find((q: any) => q.questionId === selectedQuestionId) ?? null
    : null;
  const currentResult = currentItem?.resultId
    ? results?.find((r: any) => r._id === currentItem.resultId)
    : null;
  const currentQuestion = currentItem
    ? questions?.find((q: any) => q._id === currentItem.questionId)
    : null;
  const currentAnnotation = currentItem?.resultId
    ? annotationMap.get(currentItem.resultId.toString())
    : null;
  const isPending = currentItem ? currentItem.resultId === null : false;
  const isLive =
    selectedExperiment?.status === "running" || selectedExperiment?.status === "pending";
  const pendingCount = questionItems.filter((q: any) => q.resultId === null).length;

  // Mutations
  const upsertAnnotation = useMutation(api.annotations.crud.upsert);
  const updateTags = useMutation(api.annotations.crud.updateTags);

  const handleRate = useCallback(
    async (rating: "great" | "good_enough" | "bad") => {
      if (!currentItem?.resultId) return;
      await upsertAnnotation({
        resultId: currentItem.resultId,
        rating,
        comment: comment || undefined,
      });
    },
    [currentItem, comment, upsertAnnotation],
  );

  const handleCommentChange = useCallback((newComment: string) => {
    setComment(newComment);
  }, []);

  const handleTagsChange = useCallback(
    async (tags: string[]) => {
      if (!currentItem?.resultId) return;
      await updateTags({ resultId: currentItem.resultId, tags });
    },
    [currentItem, updateTags],
  );

  const cancelExperiment = useMutation(api.experiments.orchestration.cancelAgentExperiment);
  const handleCancel = useCallback(async () => {
    if (!selectedRunId) return;
    await cancelExperiment({ experimentId: selectedRunId });
  }, [selectedRunId, cancelExperiment]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "1") { e.preventDefault(); handleRate("great"); }
      if (e.key === "2") { e.preventDefault(); handleRate("good_enough"); }
      if (e.key === "3") { e.preventDefault(); handleRate("bad"); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const currentIdx = questionItems.findIndex(
          (q: any) => q.questionId === selectedQuestionId,
        );
        const nextIdx =
          e.key === "ArrowUp"
            ? Math.max(0, currentIdx - 1)
            : Math.min(questionItems.length - 1, currentIdx + 1);
        if (questionItems[nextIdx]) setSelectedQuestionId(questionItems[nextIdx].questionId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRate, questionItems, selectedQuestionId]);

  // Sync comment from annotation when question changes
  useEffect(() => {
    setComment(currentAnnotation?.comment ?? "");
  }, [selectedQuestionId, currentAnnotation?.comment]);

  // Debounced comment save
  useEffect(() => {
    if (!currentItem?.resultId || !currentAnnotation) return;
    const timer = setTimeout(() => {
      if (comment !== (currentAnnotation.comment ?? "")) {
        upsertAnnotation({
          resultId: currentItem.resultId!,
          rating: currentAnnotation.rating,
          comment: comment || undefined,
        });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [comment, currentItem?.resultId, currentAnnotation]);

  const handleToggleCollapse = useCallback(() => {
    setRunsCollapsed((prev: boolean) => {
      const next = !prev;
      localStorage.setItem("agents-experiment-runs-collapsed", JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sub-bar — expand button, annotation stats, keyboard hints */}
      <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-1.5">
        {/* Sidebar expand button — always visible when collapsed */}
        {runsCollapsed && (
          <button
            onClick={handleToggleCollapse}
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10 transition-colors text-xs"
            title="Show experiment runs"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span>Runs</span>
          </button>
        )}

        {/* Selected experiment name badge (when sidebar collapsed) */}
        {runsCollapsed && selectedExperiment && (
          <>
            <span className="text-text-dim text-xs bg-bg-elevated px-2 py-0.5 rounded truncate max-w-48">
              {selectedExperiment.name}
            </span>
            <div className="w-px h-4 bg-border" />
          </>
        )}

        {annotationStats && (
          <div className="flex gap-3 text-xs text-text-dim">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {annotationStats.great}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              {annotationStats.good_enough}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {annotationStats.bad}
            </span>
          </div>
        )}

        <div className="w-px h-4 bg-border" />
        <span className="text-xs text-text-dim">1/2/3 rate · ↑↓ nav</span>
      </div>

      {/* Live banner */}
      {isLive && selectedExperiment && (
        <LiveBanner experiment={selectedExperiment} onCancel={handleCancel} />
      )}

      {/* Create modal */}
      <CreateAgentExperimentModal
        open={showCreateModal}
        onClose={onCloseCreateModal}
        onCreated={onCreated}
      />

      {/* 4-pane layout */}
      <ResizablePanes
        storageKey="agents-experiment-pane-widths"
        collapsedPanes={runsCollapsed ? new Set(["runs"]) : new Set()}
        panes={[
          {
            id: "runs",
            defaultWidth: 180,
            minWidth: 140,
            content: (
              <ExperimentRunsSidebar
                experiments={agentExperiments}
                selectedRunId={selectedRunId}
                onSelect={(id) => onSelectRun(id)}
                collapsed={runsCollapsed}
                onToggleCollapse={handleToggleCollapse}
              />
            ),
          },
          {
            id: "questions",
            defaultWidth: 220,
            minWidth: 180,
            content: (
              <ExperimentQuestionList
                items={questionItems}
                selectedQuestionId={selectedQuestionId}
                onSelectQuestion={setSelectedQuestionId}
                stats={annotationStats ?? null}
                isLive={isLive}
                pendingCount={pendingCount}
              />
            ),
          },
          {
            id: "answer",
            defaultWidth: 0,
            minWidth: 300,
            flex: true,
            content: (
              <ExperimentAnnotationPane
                question={
                  currentQuestion
                    ? { _id: currentQuestion._id, queryText: currentQuestion.queryText }
                    : null
                }
                result={
                  currentResult
                    ? {
                        _id: currentResult._id,
                        answerText: currentResult.answerText,
                        usage: currentResult.usage,
                        latencyMs: currentResult.latencyMs,
                        status: currentResult.status as "complete" | "error",
                        error: currentResult.error,
                      }
                    : null
                }
                annotation={
                  currentAnnotation
                    ? {
                        rating: currentAnnotation.rating,
                        comment: currentAnnotation.comment,
                        tags: currentAnnotation.tags,
                      }
                    : null
                }
                allTags={allTags}
                isPending={isPending}
                comment={comment}
                onRate={handleRate}
                onCommentChange={handleCommentChange}
                onTagsChange={handleTagsChange}
              />
            ),
          },
          {
            id: "metadata",
            defaultWidth: 240,
            minWidth: 180,
            content: (
              <ExperimentMetadataPane
                result={
                  currentResult
                    ? {
                        toolCalls: currentResult.toolCalls ?? [],
                        retrievedChunks: currentResult.retrievedChunks ?? [],
                        scores: currentResult.scores,
                      }
                    : null
                }
                question={
                  currentQuestion
                    ? {
                        groundTruth: currentQuestion.relevantSpans?.map((s: any) => ({
                          docId: s.docId,
                          spans: [{ start: s.start, end: s.end }],
                        })),
                      }
                    : null
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}
