"use client";

import { RatingButton } from "./RatingButton";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import type { Rating } from "./types";

interface AnnotationWorkspaceProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  result: any | null;
  question: any | null;
  annotation: any | null;
  comment: string;
  onCommentChange: (c: string) => void;
  onRate: (rating: Rating) => void;
  isPending: boolean;
  emptyMessage: string;
}

export function AnnotationWorkspace({
  result,
  question,
  annotation,
  comment,
  onCommentChange,
  onRate,
  isPending,
  emptyMessage,
}: AnnotationWorkspaceProps) {
  // Nothing selected at all
  if (!result && !isPending) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
        {emptyMessage}
      </div>
    );
  }

  // Pending question — show question + skeleton answer
  if (isPending) {
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

        {/* Skeleton AI Answer */}
        <div className="border border-purple-500/20 rounded-lg bg-bg-elevated p-5">
          <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
            AI Answer
          </div>
          <div className="space-y-3 animate-pulse">
            <div className="h-3 bg-border/50 rounded w-full" />
            <div className="h-3 bg-border/50 rounded w-5/6" />
            <div className="h-3 bg-border/50 rounded w-4/6" />
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-purple-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400" />
            </span>
            Waiting for evaluation...
          </div>
        </div>

        {/* Disabled rating section */}
        <div className="border border-border rounded-lg bg-bg-elevated p-5 opacity-40">
          <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
            Rating
          </div>
          <div className="flex gap-3">
            <div className="flex-1 py-2.5 px-4 rounded-lg border border-border text-sm text-center text-text-dim">
              Great [1]
            </div>
            <div className="flex-1 py-2.5 px-4 rounded-lg border border-border text-sm text-center text-text-dim">
              Good Enough [2]
            </div>
            <div className="flex-1 py-2.5 px-4 rounded-lg border border-border text-sm text-center text-text-dim">
              Bad [3]
            </div>
          </div>
        </div>
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
          <div className="max-h-96 overflow-y-auto">
            <MarkdownViewer content={result.answerText} showToggle={true} />
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
