"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { useParams } from "next/navigation";
import Link from "next/link";

type FilterType = "all" | "unrated" | "great" | "good_enough" | "bad";

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

  const upsertAnnotation = useMutation(api.annotations.crud.upsert);

  // --- State ---
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [comment, setComment] = useState("");

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

  // Filter results based on current filter
  const filteredResults = useMemo(() => {
    if (!results) return [];
    return results.filter((r) => {
      if (filter === "all") return true;
      const annotation = annotationMap.get(r._id);
      if (filter === "unrated") return !annotation;
      return annotation?.rating === filter;
    });
  }, [results, filter, annotationMap]);

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
  }, [filter]);

  // --- Keyboard shortcuts ---
  const handleRate = useCallback(
    async (rating: "great" | "good_enough" | "bad") => {
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
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
          >
            <option value="all">All ({results.length})</option>
            <option value="unrated">
              Unrated ({results.length - (stats?.annotated ?? 0)})
            </option>
            <option value="great">Great ({stats?.great ?? 0})</option>
            <option value="good_enough">
              Good Enough ({stats?.good_enough ?? 0})
            </option>
            <option value="bad">Bad ({stats?.bad ?? 0})</option>
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="px-2 py-1 text-xs rounded border border-border text-text-dim hover:text-text disabled:opacity-30 transition-colors"
            >
              &larr; Prev
            </button>
            <span className="text-xs text-text-dim px-2">
              {filteredResults.length > 0
                ? `${currentIndex + 1} / ${filteredResults.length}`
                : "0 / 0"}
            </span>
            <button
              onClick={() =>
                setCurrentIndex(
                  Math.min(filteredResults.length - 1, currentIndex + 1),
                )
              }
              disabled={currentIndex >= filteredResults.length - 1}
              className="px-2 py-1 text-xs rounded border border-border text-text-dim hover:text-text disabled:opacity-30 transition-colors"
            >
              Next &rarr;
            </button>
          </div>
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

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {!currentResult ? (
          <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
            {filteredResults.length === 0
              ? "No results match the current filter."
              : "Select a result to annotate."}
          </div>
        ) : (
          <>
            {/* Left pane: question, answer, scores, rating */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Question */}
              <div className="border border-border rounded-lg bg-bg-elevated p-5">
                <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
                  Question
                </div>
                <div className="text-text text-base font-medium">
                  {currentQuestion?.queryText ?? "Loading..."}
                </div>
              </div>

              {/* AI Answer */}
              <div className="border border-border rounded-lg bg-bg-elevated p-5">
                <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
                  AI Answer
                </div>
                {currentResult.status === "error" ? (
                  <div className="text-red-400 text-sm">
                    Error: {currentResult.error ?? "Unknown error"}
                  </div>
                ) : (
                  <div className="text-text text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {currentResult.answerText}
                  </div>
                )}
                {currentResult.usage && (
                  <div className="mt-3 text-[10px] text-text-dim">
                    {currentResult.usage.promptTokens} prompt +{" "}
                    {currentResult.usage.completionTokens} completion tokens |{" "}
                    {(currentResult.latencyMs / 1000).toFixed(1)}s
                  </div>
                )}
              </div>

              {/* Retrieval Metrics — only shown when agent made tool calls */}
              {currentResult.toolCalls.length > 0 && currentResult.scores && (
                <div className="flex gap-4 text-sm">
                  {Object.entries(
                    currentResult.scores as Record<string, number>,
                  ).map(([key, value]) => (
                    <span key={key} className="text-text-muted">
                      {key === "iou" ? "IoU" : key}:{" "}
                      <span className="text-accent">{value.toFixed(3)}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Rating section */}
              <div className="border border-border rounded-lg bg-bg-elevated p-5">
                <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
                  Rating{" "}
                  <span className="normal-case text-text-dim/60">
                    (keyboard: 1=Great, 2=Good Enough, 3=Bad)
                  </span>
                </div>
                <div className="flex gap-3 mb-4">
                  <RatingButton
                    label="Great"
                    shortcut="1"
                    active={currentAnnotation?.rating === "great"}
                    color="accent"
                    onClick={() => handleRate("great")}
                  />
                  <RatingButton
                    label="Good Enough"
                    shortcut="2"
                    active={currentAnnotation?.rating === "good_enough"}
                    color="yellow"
                    onClick={() => handleRate("good_enough")}
                  />
                  <RatingButton
                    label="Bad"
                    shortcut="3"
                    active={currentAnnotation?.rating === "bad"}
                    color="red"
                    onClick={() => handleRate("bad")}
                  />
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Optional comment..."
                  rows={2}
                  className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none resize-none"
                />
              </div>
            </div>

            {/* Right pane: retrieved chunks, tool calls, ground truth */}
            <div className="w-96 border-l border-border overflow-y-auto p-4 space-y-2 shrink-0">
              {/* Collapsible: Retrieved Chunks */}
              <CollapsibleSection
                title={`Retrieved Chunks (${currentResult.retrievedChunks.length})`}
              >
                {currentResult.retrievedChunks.length === 0 ? (
                  <div className="text-text-dim text-xs">
                    No chunks retrieved.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {currentResult.retrievedChunks.map(
                      (chunk: any, i: number) => (
                        <div
                          key={i}
                          className="border border-border rounded p-3 text-xs"
                        >
                          <div className="text-text-dim mb-1">
                            doc: {chunk.docId} | chars {chunk.start}-{chunk.end}
                          </div>
                          <div className="text-text whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {chunk.content}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </CollapsibleSection>

              {/* Collapsible: Tool Calls */}
              <CollapsibleSection
                title={`Tool Calls (${currentResult.toolCalls.length})`}
              >
                {currentResult.toolCalls.length === 0 ? (
                  <div className="text-text-dim text-xs">No tool calls.</div>
                ) : (
                  <div className="space-y-3">
                    {currentResult.toolCalls.map((tc: any, i: number) => (
                      <div
                        key={i}
                        className="border border-border rounded p-3 text-xs"
                      >
                        <div className="font-medium text-text mb-1">
                          {tc.toolName}
                        </div>
                        <div className="text-text-dim">
                          Query: &quot;{tc.query}&quot;
                        </div>
                        <div className="text-text-dim mt-1">
                          {tc.chunks.length} chunks returned
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* Collapsible: Ground Truth */}
              {currentQuestion?.relevantSpans && (
                <CollapsibleSection
                  title={`Ground Truth (${currentQuestion.relevantSpans.length} spans)`}
                >
                  <div className="space-y-2">
                    {currentQuestion.relevantSpans.map(
                      (span: any, i: number) => (
                        <div
                          key={i}
                          className="border border-border rounded p-3 text-xs"
                        >
                          <div className="text-text-dim mb-1">
                            doc: {span.docId} | chars {span.start}-{span.end}
                          </div>
                          <div className="text-text whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {span.text}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </CollapsibleSection>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg bg-bg-elevated">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between text-xs text-text-dim uppercase tracking-wider hover:text-text transition-colors"
      >
        {title}
        <span className="text-base">{open ? "\u25B4" : "\u25BE"}</span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rating Button
// ---------------------------------------------------------------------------

function RatingButton({
  label,
  shortcut,
  active,
  color,
  onClick,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  color: "accent" | "yellow" | "red";
  onClick: () => void;
}) {
  const colorMap = {
    accent: active
      ? "bg-accent/20 border-accent/50 text-accent"
      : "border-border text-text-dim hover:border-accent/30 hover:text-accent",
    yellow: active
      ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
      : "border-border text-text-dim hover:border-yellow-500/30 hover:text-yellow-400",
    red: active
      ? "bg-red-500/20 border-red-500/50 text-red-400"
      : "border-border text-text-dim hover:border-red-500/30 hover:text-red-400",
  };

  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors ${colorMap[color]}`}
    >
      {label}{" "}
      <span className="text-[10px] opacity-50 ml-1">[{shortcut}]</span>
    </button>
  );
}
