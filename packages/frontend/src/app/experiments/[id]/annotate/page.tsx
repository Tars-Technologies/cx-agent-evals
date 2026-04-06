"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useParams } from "next/navigation";
import Link from "next/link";

import { QuestionListPane } from "./_components/QuestionListPane";
import { AnnotationWorkspace } from "./_components/AnnotationWorkspace";
import { MetadataPane } from "./_components/MetadataPane";
import type { FilterType, Rating } from "./_components/types";

export default function AnnotatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-screen">
          <Header mode="experiments" />
        </div>
      }
    >
      <AnnotateContent />
    </Suspense>
  );
}

function AnnotateContent() {
  const params = useParams();
  const experimentId = params.id as Id<"experiments">;

  // --- Data queries ---
  const experiment = useQuery(api.experiments.orchestration.get, {
    id: experimentId,
  });
  const results = useQuery(api.experiments.agentResults.byExperiment, {
    experimentId,
  });
  const annotations = useQuery(api.annotations.crud.byExperiment, {
    experimentId,
  });
  const stats = useQuery(api.annotations.crud.stats, { experimentId });
  const questions = useQuery(
    api.crud.questions.byDataset,
    experiment?.datasetId ? { datasetId: experiment.datasetId } : "skip",
  );
  const allTags = useQuery(api.annotations.crud.allTags, { experimentId });

  const upsertAnnotation = useMutation(api.annotations.crud.upsert);

  // --- State ---
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [comment, setComment] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const isLive = experiment?.status === "running" || experiment?.status === "pending";

  // --- Build joined data ---
  const questionMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const q of questions ?? []) {
      map.set(q._id, q);
    }
    return map;
  }, [questions]);

  // Map from questionId -> result (for merging questions with results)
  const resultByQuestionId = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of results ?? []) {
      map.set(r.questionId, r);
    }
    return map;
  }, [results]);

  const annotationMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of annotations ?? []) {
      map.set(a.resultId, a);
    }
    return map;
  }, [annotations]);

  // Build unified list: only questions with ground truth spans (matches backend filter)
  // Questions without relevantSpans are skipped during experiment execution
  type QuestionItem = { question: any; result: any | null };
  const allItems: QuestionItem[] = useMemo(() => {
    if (!questions) return [];
    const evaluatable = questions.filter(
      (q) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0,
    );
    return evaluatable.map((q) => ({
      question: q,
      result: resultByQuestionId.get(q._id) ?? null,
    }));
  }, [questions, resultByQuestionId]);

  // Filter items: rating -> tag -> search
  const filteredItems = useMemo(() => {
    return allItems.filter(({ question: q, result: r }) => {
      const annotation = r ? annotationMap.get(r._id) : null;
      // Rating filter
      if (filter === "unrated") {
        if (annotation) return false; // rated items excluded
      } else if (filter !== "all") {
        if (annotation?.rating !== filter) return false;
      }
      // Tag filter
      if (tagFilter && !annotation?.tags?.includes(tagFilter)) return false;
      // Search filter
      if (searchQuery) {
        if (!q?.queryText.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
      }
      return true;
    });
  }, [allItems, filter, tagFilter, searchQuery, annotationMap]);

  // Current item
  const currentItem = filteredItems[currentIndex] ?? null;
  const currentResult = currentItem?.result ?? null;
  const currentQuestion = currentItem?.question ?? null;
  const currentAnnotation = currentResult
    ? annotationMap.get(currentResult._id)
    : null;

  // Load existing annotation into comment field when navigating
  useEffect(() => {
    setComment(currentAnnotation?.comment ?? "");
  }, [currentAnnotation?.comment, currentIndex]);

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [filter, tagFilter, searchQuery]);

  // --- Rating handler ---
  const handleRate = useCallback(
    async (rating: Rating) => {
      if (!currentResult) return;
      await upsertAnnotation({
        resultId: currentResult._id,
        rating,
        comment: comment || undefined,
      });
      // Auto-advance to next unrated
      const nextUnrated = filteredItems.findIndex(({ result: r }, i) => {
        if (i <= currentIndex) return false;
        if (!r) return false; // skip pending
        return !annotationMap.get(r._id);
      });
      if (nextUnrated !== -1) {
        setCurrentIndex(nextUnrated);
      } else if (currentIndex < filteredItems.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
    [
      currentResult,
      comment,
      upsertAnnotation,
      filteredItems,
      currentIndex,
      annotationMap,
    ],
  );

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;
      if (e.key === "1") handleRate("great");
      else if (e.key === "2") handleRate("good_enough");
      else if (e.key === "3") handleRate("bad");
      else if (e.key === "ArrowLeft" && currentIndex > 0)
        setCurrentIndex(currentIndex - 1);
      else if (
        e.key === "ArrowRight" &&
        currentIndex < filteredItems.length - 1
      )
        setCurrentIndex(currentIndex + 1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRate, currentIndex, filteredItems.length]);

  // --- Loading states ---
  if (!experiment || !results || !questions) {
    return (
      <div className="flex flex-col h-screen">
        <Header mode="experiments" />
        <div className="flex-1 flex items-center justify-center text-text-dim">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
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
          <div className="text-sm font-medium text-text">{experiment.name}</div>
          {stats && (
            <div className="text-xs text-text-dim">
              {stats.annotated}/{stats.total} annotated
              {stats.annotated > 0 && (
                <span className="ml-2">
                  ({stats.great} great, {stats.good_enough} ok, {stats.bad} bad)
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-dim/60">
          <kbd className="px-1.5 py-0.5 rounded border border-border">1</kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border">2</kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border">3</kbd>
          rate &middot;
          <kbd className="px-1.5 py-0.5 rounded border border-border">&larr;</kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border">&rarr;</kbd>
          navigate
        </div>
      </div>

      {/* Live experiment banner */}
      {isLive && (
        <div className="flex items-center gap-3 px-6 py-2 bg-purple-500/10 border-b border-purple-500/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400" />
          </span>
          <span className="text-xs text-purple-300">
            Experiment running — {experiment?.processedQuestions ?? 0} of{" "}
            {experiment?.totalQuestions ?? "?"} questions processed
          </span>
          {experiment?.totalQuestions && experiment.totalQuestions > 0 && (
            <div className="flex-1 max-w-xs h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-400 transition-all duration-500"
                style={{
                  width: `${((experiment.processedQuestions ?? 0) / experiment.totalQuestions) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Annotation progress bar */}
      {stats && stats.total > 0 && (
        <div className="h-1 bg-border">
          <div
            className="h-full bg-accent transition-all"
            style={{
              width: `${(stats.annotated / stats.total) * 100}%`,
            }}
          />
        </div>
      )}

      {/* Three-pane layout */}
      <div className="flex-1 overflow-hidden flex">
        <QuestionListPane
          items={filteredItems}
          annotationMap={annotationMap}
          currentIndex={currentIndex}
          onSelectResult={setCurrentIndex}
          stats={stats ?? null}
          totalQuestions={allItems.length}
          totalResults={results?.length ?? 0}
          isLive={isLive}
          filter={filter}
          onFilterChange={setFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          allTags={allTags ?? []}
        />

        <AnnotationWorkspace
          result={currentResult}
          question={currentQuestion}
          annotation={currentAnnotation}
          comment={comment}
          onCommentChange={setComment}
          onRate={handleRate}
          isPending={currentItem !== null && currentResult === null}
          emptyMessage={
            filteredItems.length === 0
              ? "No results match the current filter."
              : "Select a result to annotate."
          }
        />

        <MetadataPane
          result={currentResult}
          question={currentQuestion}
          annotation={currentAnnotation}
          allTags={allTags ?? []}
        />
      </div>
    </div>
  );
}
