"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Turn = {
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system";
  content: string;
};

export type Annotation = {
  rating: "great" | "good_enough" | "bad" | "pass" | "fail";
  comment?: string;
  tags: string[];
};

export interface AnnotationEditorProps {
  conversation: { turns: Turn[] };
  existingAnnotation: Annotation | null;
  allTags: string[];
  onUpsert(input: {
    rating: Annotation["rating"];
    comment?: string;
    tags: string[];
  }): Promise<void>;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RatingValue = Annotation["rating"];

interface RatingConfig {
  value: RatingValue;
  label: string;
  activeClass: string;
  hoverClass: string;
}

const RATING_CONFIGS: RatingConfig[] = [
  {
    value: "great",
    label: "Great",
    activeClass: "bg-accent/20 border-accent/50 text-accent",
    hoverClass: "hover:border-accent/30 hover:text-accent",
  },
  {
    value: "good_enough",
    label: "Good Enough",
    activeClass: "bg-yellow-500/20 border-yellow-500/50 text-yellow-400",
    hoverClass: "hover:border-yellow-500/30 hover:text-yellow-400",
  },
  {
    value: "bad",
    label: "Bad",
    activeClass: "bg-red-500/20 border-red-500/50 text-red-400",
    hoverClass: "hover:border-red-500/30 hover:text-red-400",
  },
  {
    value: "pass",
    label: "Pass",
    activeClass: "bg-blue-500/20 border-blue-500/50 text-blue-400",
    hoverClass: "hover:border-blue-500/30 hover:text-blue-400",
  },
  {
    value: "fail",
    label: "Fail",
    activeClass: "bg-orange-500/20 border-orange-500/50 text-orange-400",
    hoverClass: "hover:border-orange-500/30 hover:text-orange-400",
  },
];

// Role display config
const ROLE_STYLES: Record<
  Turn["role"],
  { label: string; bubbleClass: string; labelClass: string }
> = {
  user: {
    label: "User",
    bubbleClass: "bg-bg-elevated border border-border",
    labelClass: "text-text-muted",
  },
  assistant: {
    label: "Assistant",
    bubbleClass: "bg-accent/10 border border-accent/25",
    labelClass: "text-accent",
  },
  tool_call: {
    label: "Tool Call",
    bubbleClass: "bg-purple-500/10 border border-purple-500/25",
    labelClass: "text-purple-400",
  },
  tool_result: {
    label: "Tool Result",
    bubbleClass: "bg-purple-500/5 border border-purple-500/15",
    labelClass: "text-purple-300",
  },
  system: {
    label: "System",
    bubbleClass: "bg-bg-elevated border border-dashed border-border",
    labelClass: "text-text-dim",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConversationTranscript({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) {
    return (
      <div className="text-sm text-text-dim italic">
        No conversation turns.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {turns.map((turn, i) => {
        const style = ROLE_STYLES[turn.role];
        return (
          <div key={i} className={`rounded-lg p-3 ${style.bubbleClass}`}>
            <div
              className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${style.labelClass}`}
            >
              {style.label}
            </div>
            <div className="text-sm text-text whitespace-pre-wrap leading-relaxed font-mono">
              {turn.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TagsCombobox({
  currentTags,
  allTags,
  disabled,
  onTagsChange,
}: {
  currentTags: string[];
  allTags: string[];
  disabled: boolean;
  onTagsChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  const suggestions = allTags.filter(
    (t) =>
      t.toLowerCase().includes(input.toLowerCase()) && !currentTags.includes(t)
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
              {!disabled && (
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:text-red-400 transition-colors"
                  aria-label={`Remove tag ${tag}`}
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
            setSelectedSuggestion(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "" : "Add a tag…"}
          className="w-full px-3 py-1.5 text-sm bg-bg-elevated border border-border rounded text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {showSuggestions && suggestions.length > 0 && !disabled && (
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AnnotationEditor({
  conversation,
  existingAnnotation,
  allTags,
  onUpsert,
  disabled = false,
}: AnnotationEditorProps): JSX.Element {
  const [rating, setRating] = useState<RatingValue | null>(
    existingAnnotation?.rating ?? null
  );
  const [comment, setComment] = useState<string>(
    existingAnnotation?.comment ?? ""
  );
  const [tags, setTags] = useState<string[]>(existingAnnotation?.tags ?? []);
  const [isSaving, setIsSaving] = useState(false);

  // Sync from outside when existingAnnotation reference changes
  const prevAnnotationRef = useRef<Annotation | null>(null);
  useEffect(() => {
    if (existingAnnotation !== prevAnnotationRef.current) {
      prevAnnotationRef.current = existingAnnotation;
      setRating(existingAnnotation?.rating ?? null);
      setComment(existingAnnotation?.comment ?? "");
      setTags(existingAnnotation?.tags ?? []);
    }
  }, [existingAnnotation]);

  // Debounced comment save
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireUpsert = useCallback(
    async (
      nextRating: RatingValue,
      nextComment: string,
      nextTags: string[]
    ) => {
      if (disabled) return;
      setIsSaving(true);
      try {
        await onUpsert({
          rating: nextRating,
          comment: nextComment || undefined,
          tags: nextTags,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [disabled, onUpsert]
  );

  const handleRating = useCallback(
    (newRating: RatingValue) => {
      if (disabled) return;
      setRating(newRating);
      // Fire immediately; cancel any pending comment debounce and include current comment
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void fireUpsert(newRating, comment, tags);
    },
    [disabled, comment, tags, fireUpsert]
  );

  const handleCommentChange = useCallback(
    (newComment: string) => {
      if (disabled) return;
      setComment(newComment);
      if (!rating) return; // Don't save until rated
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      setIsSaving(true);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void fireUpsert(rating, newComment, tags);
      }, 500);
    },
    [disabled, rating, tags, fireUpsert]
  );

  const handleTagsChange = useCallback(
    (newTags: string[]) => {
      if (disabled) return;
      setTags(newTags);
      if (!rating) return; // Don't save until rated
      // Cancel any pending comment debounce; fire immediately with current comment
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void fireUpsert(rating, comment, newTags);
    },
    [disabled, rating, comment, fireUpsert]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Scrollable conversation transcript */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
          Conversation
        </div>
        <ConversationTranscript turns={conversation.turns} />
      </div>

      {/* Sticky annotation controls */}
      <div className="flex-shrink-0 border-t border-border bg-bg p-4 space-y-3">
        {/* Saving indicator */}
        {isSaving && (
          <div className="text-[10px] text-text-dim text-right animate-pulse">
            Saving…
          </div>
        )}

        {/* Rating buttons */}
        <div className="flex flex-wrap gap-2">
          {RATING_CONFIGS.map((cfg) => {
            const isSelected = rating === cfg.value;
            return (
              <button
                key={cfg.value}
                onClick={() => handleRating(cfg.value)}
                disabled={disabled}
                className={`flex-1 min-w-[80px] py-2 px-3 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? cfg.activeClass
                    : `border-border text-text-dim ${cfg.hoverClass}`
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Tags — only shown once a rating is selected */}
        {rating !== null && (
          <TagsCombobox
            currentTags={tags}
            allTags={allTags}
            disabled={disabled}
            onTagsChange={handleTagsChange}
          />
        )}

        {/* Comment textarea */}
        <textarea
          value={comment}
          onChange={(e) => handleCommentChange(e.target.value)}
          disabled={disabled}
          placeholder={disabled ? "" : "Optional comment…"}
          rows={2}
          className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
