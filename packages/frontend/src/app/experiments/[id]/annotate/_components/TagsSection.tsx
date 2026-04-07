"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface TagsSectionProps {
  resultId: Id<"agentExperimentResults">;
  currentTags: string[];
  allTags: string[];
  hasAnnotation: boolean;
}

export function TagsSection({
  resultId,
  currentTags,
  allTags,
  hasAnnotation,
}: TagsSectionProps) {
  const updateTags = useMutation(api.annotations.crud.updateTags);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset input when switching results
  useEffect(() => {
    setInput("");
    setShowSuggestions(false);
    setSelectedSuggestion(-1);
  }, [resultId]);

  const suggestions = allTags.filter(
    (t) =>
      !currentTags.includes(t) &&
      t.toLowerCase().includes(input.toLowerCase()),
  );

  const addTag = useCallback(
    async (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed || currentTags.includes(trimmed)) return;
      const newTags = [...currentTags, trimmed];
      await updateTags({ resultId, tags: newTags });
      setInput("");
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
    },
    [currentTags, resultId, updateTags],
  );

  const removeTag = useCallback(
    async (tag: string) => {
      const newTags = currentTags.filter((t) => t !== tag);
      await updateTags({ resultId, tags: newTags });
    },
    [currentTags, resultId, updateTags],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
          addTag(suggestions[selectedSuggestion]);
        } else if (input.trim()) {
          addTag(input);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        setSelectedSuggestion(-1);
      } else if (e.key === "Backspace" && !input && currentTags.length > 0) {
        removeTag(currentTags[currentTags.length - 1]);
      }
    },
    [input, selectedSuggestion, suggestions, currentTags, addTag, removeTag],
  );

  if (!hasAnnotation) {
    return (
      <div className="p-4 border-b border-border">
        <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
          Tags
        </div>
        <div className="text-xs text-text-dim/60">
          Rate this result first to add tags.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-border">
      <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
        Tags
      </div>

      {/* Existing tags */}
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

      {/* Input with autocomplete */}
      <div className="relative">
        <input
          ref={inputRef}
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
