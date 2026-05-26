"use client"

import { useRef, useState } from "react"

export function RealWorldQuestionsModal({
  initialQuestions,
  onSave,
  onClose
}: {
  initialQuestions: string[]
  onSave: (questions: string[]) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<"upload" | "paste">("upload")
  const [questions, setQuestions] = useState<string[]>(initialQuestions)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function parseLines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  }

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const lines = parseLines(text)
      // Skip header if it looks like one (contains "question" case-insensitive)
      if (lines.length > 0 && /^"?question"?$/i.test(lines[0])) {
        lines.shift()
      }
      // Remove CSV quoting
      const cleaned = lines.map((l) =>
        l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1) : l
      )
      setQuestions(cleaned)
    }
    reader.readAsText(file)
  }

  function handlePaste(text: string) {
    setQuestions(parseLines(text))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in">
      <div className="bg-bg-elevated border border-border rounded-xl w-[560px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">
            Real-World Questions
          </h2>
          <p className="text-[11px] text-text-muted mt-1">
            Upload a CSV or paste questions (one per line)
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("upload")}
            className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
              tab === "upload"
                ? "text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            Upload CSV
          </button>
          <button
            onClick={() => setTab("paste")}
            className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
              tab === "paste"
                ? "text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            Paste Questions
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "upload" && (
            <div className="space-y-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-6 text-center
                           hover:border-accent/30 hover:bg-accent/5 transition-all cursor-pointer"
              >
                <p className="text-xs text-text-muted">
                  Click to upload a CSV file
                </p>
                <p className="text-[10px] text-text-dim mt-1">
                  Single column, one question per row
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleCSVUpload}
                className="hidden"
              />
            </div>
          )}

          {tab === "paste" && (
            <textarea
              placeholder="How do I reset my password?&#10;What authentication methods are supported?&#10;Why is SSO failing after the upgrade?"
              defaultValue={questions.join("\n")}
              onChange={(e) => handlePaste(e.target.value)}
              className="w-full h-48 bg-bg-surface border border-border rounded-lg p-3 text-xs text-text
                         placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors
                         resize-none font-mono"
            />
          )}

          {/* Preview */}
          {questions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-text-muted">
                  {questions.length} question{questions.length !== 1 ? "s" : ""}{" "}
                  loaded
                </span>
                <button
                  onClick={() => setQuestions([])}
                  className="text-[10px] text-error hover:text-error/80 transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto border border-border rounded-lg bg-bg-surface">
                {questions.slice(0, 50).map((q, i) => (
                  <div
                    key={i}
                    className="px-3 py-1.5 text-[11px] text-text border-b border-border last:border-0"
                  >
                    {q}
                  </div>
                ))}
                {questions.length > 50 && (
                  <div className="px-3 py-1.5 text-[10px] text-text-dim">
                    ... and {questions.length - 50} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs text-text-muted
                       hover:text-text hover:bg-bg-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(questions)}
            disabled={questions.length === 0}
            className="px-4 py-1.5 rounded text-xs font-semibold
                       bg-accent/10 border border-accent/30 text-accent
                       hover:bg-accent/20 hover:border-accent/50 transition-all cursor-pointer
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save ({questions.length})
          </button>
        </div>
      </div>
    </div>
  )
}
