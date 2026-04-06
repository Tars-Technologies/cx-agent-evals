"use client";

import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface UnmappedQuestion {
  questionId: Id<"questions">;
  queryText: string;
  rating?: string;
  tags?: string[];
}

interface FailureMode {
  _id: Id<"failureModes">;
  name: string;
}

interface UnmappedPaneProps {
  unmappedQuestions: UnmappedQuestion[];
  failureModes: FailureMode[];
  experimentId: Id<"experiments">;
}

export function UnmappedPane({
  unmappedQuestions,
  failureModes,
  experimentId,
}: UnmappedPaneProps) {
  const assignQuestion = useMutation(api.failureModes.crud.assignQuestion);

  const handleAssign = async (
    questionId: Id<"questions">,
    failureModeId: string,
  ) => {
    if (!failureModeId) return;
    await assignQuestion({
      failureModeId: failureModeId as Id<"failureModes">,
      questionId,
      experimentId,
    });
  };

  const isPass = (rating?: string) =>
    rating === "pass" || rating === "great" || rating === "good_enough";

  return (
    <div className="w-96 border-l border-border shrink-0 flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border">
        <span className="text-xs text-text-dim">
          <span className="text-accent font-medium">
            {unmappedQuestions.length}
          </span>{" "}
          unmapped question{unmappedQuestions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {unmappedQuestions.length === 0 ? (
          <div className="p-4 text-xs text-text-dim text-center">
            All annotated questions have been mapped.
          </div>
        ) : (
          unmappedQuestions.map((q) => (
            <div
              key={q.questionId}
              className="px-4 py-3 border-b border-border/50 space-y-2"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    isPass(q.rating)
                      ? "bg-accent/10 text-accent"
                      : "bg-red-400/10 text-red-400"
                  }`}
                >
                  {isPass(q.rating) ? "Pass" : "Fail"}
                </span>
                <div className="text-sm text-text line-clamp-2">
                  {q.queryText}
                </div>
              </div>

              {q.tags && q.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {q.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-dim"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Assign dropdown */}
              <select
                defaultValue=""
                onChange={(e) => handleAssign(q.questionId, e.target.value)}
                className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text focus:border-accent outline-none"
              >
                <option value="" disabled>
                  Assign to failure mode...
                </option>
                {failureModes.map((fm) => (
                  <option key={fm._id} value={fm._id}>
                    {fm.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
