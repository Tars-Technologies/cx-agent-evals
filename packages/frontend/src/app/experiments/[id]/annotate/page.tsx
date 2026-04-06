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

  // --- Build joined data ---
  const questionMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const q of questions ?? []) {
      map.set(q._id, q);
    }
    return map;
  }, [questions]);

  const annotationMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of annotations ?? []) {
      map.set(a.resultId, a);
    }
    return map;
  }, [annotations]);

  // Filter results: rating -> tag -> search
  const filteredResults = useMemo(() => {
    if (!results) return [];
    return results.filter((r) => {
      const annotation = annotationMap.get(r._id);
      // Rating filter
      if (filter === "unrated" && annotation) return false;
      if (filter !== "all" && filter !== "unrated" && annotation?.rating !== filter)
        return false;
      // Tag filter
      if (tagFilter && !annotation?.tags?.includes(tagFilter)) return false;
      // Search filter
      if (searchQuery) {
        const q = questionMap.get(r.questionId);
        if (!q?.queryText.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
      }
      return true;
    });
  }, [results, filter, tagFilter, searchQuery, annotationMap, questionMap]);

  // Current result
  const currentResult = filteredResults[currentIndex] ?? null;
  const currentQuestion = currentResult
    ? questionMap.get(currentResult.questionId)
    : null;
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
      const nextUnrated = filteredResults.findIndex((r, i) => {
        if (i <= currentIndex) return false;
        return !annotationMap.get(r._id);
      });
      if (nextUnrated !== -1) {
        setCurrentIndex(nextUnrated);
      } else if (currentIndex < filteredResults.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
    [
      currentResult,
      comment,
      upsertAnnotation,
      filteredResults,
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
        currentIndex < filteredResults.length - 1
      )
        setCurrentIndex(currentIndex + 1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRate, currentIndex, filteredResults.length]);

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

      {/* Progress bar */}
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
          results={filteredResults}
          questionMap={questionMap}
          annotationMap={annotationMap}
          currentResultId={currentResult?._id ?? null}
          onSelectResult={setCurrentIndex}
          stats={stats ?? null}
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
          emptyMessage={
            filteredResults.length === 0
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
