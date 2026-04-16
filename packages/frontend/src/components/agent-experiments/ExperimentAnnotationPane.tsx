"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownViewer } from "@/components/MarkdownViewer";

type Rating = "great" | "good_enough" | "bad";

interface ExperimentAnnotationPaneProps {
  question: { _id: Id<"questions">; queryText: string } | null;
  result: {
    _id: Id<"agentExperimentResults">;
    answerText: string;
    usage?: { promptTokens: number; completionTokens: number };
    latencyMs: number;
    status: "complete" | "error";
    error?: string;
  } | null;
  annotation: {
    rating: Rating;
    comment?: string;
    tags?: string[];
  } | null;
  allTags: string[];
  isPending: boolean;
  comment: string;
  onRate: (rating: Rating) => void;
  onCommentChange: (comment: string) => void;
  onTagsChange: (tags: string[]) => void;
}

function TagsSection({
  currentTags,
  allTags,
  onTagsChange,
}: {
  currentTags: string[];
  allTags: string[];
  onTagsChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  const suggestions = allTags.filter(
    (t) =>
      t.toLowerCase().includes(input.toLowerCase()) &&
      !currentTags.includes(t)
  );

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (trimmed && !currentTags.includes(trimmed)) {
        onTagsChange([...currentTags, trimmed]);
      }
      setInput("");
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
    },
    [currentTags, onTagsChange]
  );

  const removeTag = useCallback(
    (tag: string) => {
      onTagsChange(currentTags.filter((t) => t !== tag));
    },
    [currentTags, onTagsChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        addTag(suggestions[selectedSuggestion]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "Backspace" && input === "" && currentTags.length > 0) {
      removeTag(currentTags[currentTags.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
    }
  };

  return (
    <div>
      {currentTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {currentTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-red-400 transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
            setSelectedSuggestion(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Add a tag..."
          className="w-full px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-bg-elevated border border-border rounded shadow-lg max-h-32 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  i === selectedSuggestion
                    ? "bg-accent/20 text-accent"
                    : "text-text hover:bg-bg-hover"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ExperimentAnnotationPane({
  question,
  result,
  annotation,
  allTags,
  isPending,
  comment,
  onRate,
  onCommentChange,
  onTagsChange,
}: ExperimentAnnotationPaneProps) {
  const currentTags = annotation?.tags ?? [];

  // Empty state
  if (question === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
        Select a question to annotate
      </div>
    );
  }

  // Pending state
  if (isPending) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-6">
        <div className="border border-border rounded-lg bg-bg-elevated p-5">
          <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
            Question
          </div>
          <div className="text-text text-base font-medium">
            {question.queryText}
          </div>
        </div>
        <div className="border border-purple-500/20 rounded-lg bg-bg-elevated p-5">
          <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
            Agent Answer
          </div>
          <div className="space-y-3 animate-pulse">
            <div className="h-3 bg-border/50 rounded w-full" />
            <div className="h-3 bg-border/50 rounded w-5/6" />
            <div className="h-3 bg-border/50 rounded w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  // Active state — scrollable question+answer on top, sticky controls at bottom
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content: question + answer */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-6">
        {/* Question section */}
        <div>
          <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
            Question
          </div>
          <div className="text-text text-base">{question.queryText}</div>
        </div>

        {/* Agent Answer section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-text-dim uppercase tracking-wider">
              Agent Answer
            </div>
          </div>

          {result?.status === "error" ? (
            <div className="bg-bg-elevated rounded-md p-3">
              <div className="text-sm text-red-400">
                {result.error ?? "An error occurred"}
              </div>
            </div>
          ) : result ? (
            <div className="bg-bg-elevated rounded-md overflow-hidden">
              <MarkdownViewer
                content={result.answerText}
                showToggle={true}
              />
            </div>
          ) : null}

          {result && result.status !== "error" && (
            <div className="mt-2 text-[10px] text-text-dim">
              {result.usage
                ? `${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion tokens | `
                : ""}
              {(result.latencyMs / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom: rating + tags + comment */}
      <div className="flex-shrink-0 border-t border-border bg-bg p-4 space-y-3">
        {/* Rating row */}
        <div className="flex gap-2">
          <button
            onClick={() => onRate("great")}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              annotation?.rating === "great"
                ? "bg-accent/20 border-accent/50 text-accent"
                : "border-border text-text-dim hover:border-accent/30 hover:text-accent"
            }`}
          >
            Great{" "}
            <span className="text-[10px] opacity-50 ml-1">[1]</span>
          </button>
          <button
            onClick={() => onRate("good_enough")}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              annotation?.rating === "good_enough"
                ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
                : "border-border text-text-dim hover:border-yellow-500/30 hover:text-yellow-400"
            }`}
          >
            Good Enough{" "}
            <span className="text-[10px] opacity-50 ml-1">[2]</span>
          </button>
          <button
            onClick={() => onRate("bad")}
            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              annotation?.rating === "bad"
                ? "bg-red-500/20 border-red-500/50 text-red-400"
                : "border-border text-text-dim hover:border-red-500/30 hover:text-red-400"
            }`}
          >
            Bad{" "}
            <span className="text-[10px] opacity-50 ml-1">[3]</span>
          </button>
        </div>

        {/* Tags — only visible if rated */}
        {annotation?.rating && (
          <TagsSection
            currentTags={currentTags}
            allTags={allTags}
            onTagsChange={onTagsChange}
          />
        )}

        {/* Comment */}
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Optional comment..."
          rows={2}
          className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none resize-none"
        />
      </div>
    </div>
  );
}
