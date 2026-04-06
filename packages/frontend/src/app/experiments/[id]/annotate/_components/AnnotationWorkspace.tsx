"use client";

import { RatingButton } from "./RatingButton";
import type { Rating } from "./types";

interface AnnotationWorkspaceProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  result: any | null;
  question: any | null;
  annotation: any | null;
  comment: string;
  onCommentChange: (c: string) => void;
  onRate: (rating: Rating) => void;
  emptyMessage: string;
}

export function AnnotationWorkspace({
  result,
  question,
  annotation,
  comment,
  onCommentChange,
  onRate,
  emptyMessage,
}: AnnotationWorkspaceProps) {
  if (!result) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Question */}
      <div className="border border-border rounded-lg bg-bg-elevated p-5">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
          Question
        </div>
        <div className="text-text text-base font-medium">
          {question?.queryText ?? "Loading..."}
        </div>
      </div>

      {/* AI Answer */}
      <div className="border border-border rounded-lg bg-bg-elevated p-5">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
          AI Answer
        </div>
        {result.status === "error" ? (
          <div className="text-red-400 text-sm">
            Error: {result.error ?? "Unknown error"}
          </div>
        ) : (
          <div className="text-text text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
            {result.answerText}
          </div>
        )}
        {result.usage && (
          <div className="mt-3 text-[10px] text-text-dim">
            {result.usage.promptTokens} prompt +{" "}
            {result.usage.completionTokens} completion tokens |{" "}
            {(result.latencyMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>

      {/* Retrieval Metrics */}
      {result.toolCalls.length > 0 && result.scores && (
        <div className="flex gap-4 text-sm">
          {Object.entries(result.scores as Record<string, number>).map(
            ([key, value]) => (
              <span key={key} className="text-text-muted">
                {key === "iou" ? "IoU" : key}:{" "}
                <span className="text-accent">{value.toFixed(3)}</span>
              </span>
            ),
          )}
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
            active={annotation?.rating === "great"}
            color="accent"
            onClick={() => onRate("great")}
          />
          <RatingButton
            label="Good Enough"
            shortcut="2"
            active={annotation?.rating === "good_enough"}
            color="yellow"
            onClick={() => onRate("good_enough")}
          />
          <RatingButton
            label="Bad"
            shortcut="3"
            active={annotation?.rating === "bad"}
            color="red"
            onClick={() => onRate("bad")}
          />
        </div>
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Optional comment..."
          rows={2}
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none resize-none"
        />
      </div>
    </div>
  );
}
