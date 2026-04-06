"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface ReadyStateProps {
  experimentId: Id<"experiments">;
  annotated: number;
  total: number;
}

export function ReadyState({
  experimentId,
  annotated,
  total,
}: ReadyStateProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startGeneration = useMutation(api.failureModes.crud.startGeneration);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      await startGeneration({ experimentId });
    } catch (err: any) {
      setError(err.message ?? "Failed to start generation");
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>

        <div>
          <h3 className="text-text font-medium mb-1">
            Ready to generate failure modes
          </h3>
          <p className="text-sm text-text-dim">
            {annotated}/{total} results annotated. The AI will analyze failing
            results and identify recurring failure patterns.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-bg bg-accent rounded-lg hover:bg-accent-bright transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <span className="w-4 h-4 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            "Generate Failure Modes"
          )}
        </button>
      </div>
    </div>
  );
}
