"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharingRetriever {
  name: string;
}

interface ConfirmDeleteModalProps {
  /** "retriever" or "index" */
  action: "retriever" | "index";
  /** Name of the retriever being acted on */
  retrieverName: string;
  /** Retrievers that share the same index (excluding the current one) */
  sharingRetrievers: SharingRetriever[];
  /** Whether the retriever has an index (status is "ready" or "error") */
  hasIndex: boolean;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Callback to close modal */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDeleteModal({
  action,
  retrieverName,
  sharingRetrievers,
  hasIndex,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const [input, setInput] = useState("");
  const isConfirmed = input === "DELETE";

  const isShared = sharingRetrievers.length > 0;
  const title =
    action === "retriever" ? "Delete Retriever" : "Delete Index";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[480px] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-red-400">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Impact summary */}
          <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Retriever:</span>
              <span className="text-xs text-text font-medium">
                {retrieverName}
              </span>
            </div>
            {action === "retriever" && hasIndex && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">Index:</span>
                <span className="text-xs text-text">
                  {isShared ? "Shared with other retrievers" : "Unique to this retriever"}
                </span>
              </div>
            )}
            {action === "index" && isShared && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">Shared by:</span>
                <span className="text-xs text-text">
                  {sharingRetrievers.map((r) => r.name).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Contextual warning */}
          {action === "retriever" && hasIndex && !isShared && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
              <p className="text-xs text-red-400 font-medium">
                The index will also be permanently deleted since no other
                retriever uses it.
              </p>
            </div>
          )}
          {action === "retriever" && hasIndex && isShared && (
            <div className="border border-accent/30 bg-accent/5 rounded-lg p-3">
              <p className="text-xs text-accent">
                The index will NOT be deleted. It is still used by:{" "}
                <span className="font-medium">
                  {sharingRetrievers.map((r) => r.name).join(", ")}
                </span>
              </p>
            </div>
          )}
          {action === "index" && isShared && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
              <p className="text-xs text-red-400 font-medium mb-1">
                This will also affect {sharingRetrievers.length} other
                retriever{sharingRetrievers.length > 1 ? "s" : ""}:
              </p>
              <ul className="text-xs text-red-400 list-disc list-inside">
                {sharingRetrievers.map((r) => (
                  <li key={r.name}>{r.name}</li>
                ))}
              </ul>
              <p className="text-xs text-red-400 mt-1">
                They will stop working and need to be re-indexed.
              </p>
            </div>
          )}
          {action === "index" && !isShared && (
            <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3">
              <p className="text-xs text-yellow-400">
                This retriever will reset to &ldquo;configuring&rdquo; and need
                to be re-indexed.
              </p>
            </div>
          )}

          {/* Typed confirmation */}
          <div>
            <label className="text-xs text-text-dim block mb-1">
              Type <span className="text-text font-mono font-medium">DELETE</span> to
              confirm
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 placeholder:text-text-dim focus:outline-none focus:border-red-400/50 transition-colors"
              autoFocus
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={onConfirm}
            disabled={!isConfirmed}
            className="w-full py-2 text-sm rounded-lg font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {title}
          </button>
        </div>
      </div>
    </div>
  );
}
