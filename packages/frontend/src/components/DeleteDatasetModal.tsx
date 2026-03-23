"use client";

import { useState } from "react";

interface DeleteDatasetModalProps {
  datasetName: string;
  questionCount: number;
  strategy: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteDatasetModal({
  datasetName,
  questionCount,
  strategy,
  onConfirm,
  onClose,
}: DeleteDatasetModalProps) {
  const [input, setInput] = useState("");
  const isConfirmed = input === "DELETE";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[420px] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-red-400">Delete Dataset</h3>
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
              <span className="text-xs text-text-dim">Dataset:</span>
              <span className="text-xs text-text font-medium">{datasetName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Questions:</span>
              <span className="text-xs text-text">{questionCount} will be permanently deleted</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Strategy:</span>
              <span className="text-xs text-text">{strategy}</span>
            </div>
          </div>

          {/* Warning */}
          <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
            <p className="text-xs text-red-400">
              This action cannot be undone. All questions and their ground truth
              spans will be permanently removed.
            </p>
          </div>

          {/* Typed confirmation */}
          <div>
            <label className="text-xs text-text-dim block mb-1">
              Type{" "}
              <span className="text-text font-mono font-medium">DELETE</span>{" "}
              to confirm
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
                         placeholder:text-text-dim focus:outline-none focus:border-red-400/50 transition-colors"
              autoFocus
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={onConfirm}
            disabled={!isConfirmed}
            className="w-full py-2 text-sm rounded-lg font-medium bg-red-500 text-white
                       hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors cursor-pointer"
          >
            Delete Dataset
          </button>
        </div>
      </div>
    </div>
  );
}
