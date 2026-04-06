"use client";

import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import Link from "next/link";

interface FailureMode {
  _id: Id<"failureModes">;
  name: string;
  description: string;
}

interface MappedQuestion {
  questionId: Id<"questions">;
  queryText: string;
  rating?: string;
  tags?: string[];
}

interface FailureModeDetailProps {
  failureMode: FailureMode;
  mappedQuestions: MappedQuestion[];
  experimentId: string;
  onUnassign: (questionId: Id<"questions">) => void;
}

export function FailureModeDetail({
  failureMode,
  mappedQuestions,
  experimentId,
  onUnassign,
}: FailureModeDetailProps) {
  const updateMutation = useMutation(api.failureModes.crud.update);
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [name, setName] = useState(failureMode.name);
  const [description, setDescription] = useState(failureMode.description);

  // Reset local state when failure mode changes
  if (name !== failureMode.name && !editingName) setName(failureMode.name);
  if (description !== failureMode.description && !editingDesc)
    setDescription(failureMode.description);

  const saveName = useCallback(async () => {
    setEditingName(false);
    if (name.trim() && name !== failureMode.name) {
      await updateMutation({ failureModeId: failureMode._id, name: name.trim() });
    } else {
      setName(failureMode.name);
    }
  }, [name, failureMode, updateMutation]);

  const saveDescription = useCallback(async () => {
    setEditingDesc(false);
    if (description !== failureMode.description) {
      await updateMutation({
        failureModeId: failureMode._id,
        description: description.trim(),
      });
    }
  }, [description, failureMode, updateMutation]);

  const isPass = (rating?: string) =>
    rating === "pass" || rating === "great" || rating === "good_enough";

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Name */}
      <div className="border border-border rounded-lg bg-bg-elevated p-5">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
          Failure Mode Name
        </div>
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            className="w-full text-lg font-medium text-text bg-transparent border-b border-accent outline-none"
          />
        ) : (
          <div
            onClick={() => setEditingName(true)}
            className="text-lg font-medium text-text cursor-pointer hover:text-accent transition-colors"
          >
            {failureMode.name}
          </div>
        )}
      </div>

      {/* Description */}
      <div className="border border-border rounded-lg bg-bg-elevated p-5">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-2">
          Description
        </div>
        {editingDesc ? (
          <textarea
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={3}
            className="w-full text-sm text-text bg-transparent border border-accent rounded px-2 py-1 outline-none resize-none"
          />
        ) : (
          <div
            onClick={() => setEditingDesc(true)}
            className="text-sm text-text-muted cursor-pointer hover:text-text transition-colors"
          >
            {failureMode.description || "Click to add description..."}
          </div>
        )}
      </div>

      {/* Mapped Questions */}
      <div className="border border-border rounded-lg bg-bg-elevated p-5">
        <div className="text-xs text-text-dim uppercase tracking-wider mb-3">
          Mapped Questions ({mappedQuestions.length})
        </div>
        {mappedQuestions.length === 0 ? (
          <div className="text-sm text-text-dim">
            No questions mapped to this failure mode yet.
          </div>
        ) : (
          <div className="space-y-2">
            {mappedQuestions.map((q) => (
              <div
                key={q.questionId}
                className="flex items-start gap-3 p-3 rounded border border-border/50 bg-bg hover:bg-bg-hover transition-colors"
              >
                {/* Pass/Fail badge */}
                <span
                  className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    isPass(q.rating)
                      ? "bg-accent/10 text-accent"
                      : "bg-red-400/10 text-red-400"
                  }`}
                >
                  {isPass(q.rating) ? "Pass" : "Fail"}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text line-clamp-2">
                    {q.queryText}
                  </div>
                  {q.tags && q.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
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
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Link to annotate */}
                  <Link
                    href={`/experiments/${experimentId}/annotate`}
                    className="p-1 text-text-dim hover:text-accent transition-colors"
                    title="View in annotate"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>

                  {/* Remove mapping */}
                  <button
                    onClick={() => onUnassign(q.questionId)}
                    className="p-1 text-text-dim hover:text-red-400 transition-colors"
                    title="Remove from failure mode"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
