"use client";

import { useState, useRef } from "react";

interface WizardStepRealWorldProps {
  questions: string[];
  onChange: (questions: string[]) => void;
  onNext: () => void;
  onSkip: () => void;
}

export function WizardStepRealWorld({ questions, onChange, onNext, onSkip }: WizardStepRealWorldProps) {
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [text, setText] = useState(questions.join("\n"));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseLines = (raw: string): string[] =>
    raw.split("\n").map(l => l.trim()).filter(Boolean);

  const handleChange = (value: string) => {
    setText(value);
    onChange(parseLines(value));
  };

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      const lines = parseLines(raw);
      // Skip header if it looks like one
      if (lines.length > 0 && /^"?question"?$/i.test(lines[0])) {
        lines.shift();
      }
      // Remove CSV quoting
      const cleaned = lines.map((l) =>
        l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1) : l,
      );
      setText(cleaned.join("\n"));
      onChange(cleaned);
    };
    reader.readAsText(file);
  }

  const count = parseLines(text).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <span className="text-xs text-text-dim uppercase tracking-wider">Real-World Questions</span>
        <p className="text-xs text-text-dim mt-1">
          Upload a CSV or paste real questions from your users. These help generate more realistic evaluation questions.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("upload")}
          className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
            tab === "upload"
              ? "text-accent border-b-2 border-accent"
              : "text-text-dim hover:text-text"
          }`}
        >
          Upload CSV
        </button>
        <button
          onClick={() => setTab("paste")}
          className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
            tab === "paste"
              ? "text-accent border-b-2 border-accent"
              : "text-text-dim hover:text-text"
          }`}
        >
          Paste Questions
        </button>
      </div>

      {tab === "upload" && (
        <div className="space-y-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-6 text-center
                       hover:border-accent/30 hover:bg-accent/5 transition-all cursor-pointer"
          >
            <p className="text-xs text-text-dim">Click to upload a CSV file</p>
            <p className="text-[10px] text-text-dim mt-1">Single column, one question per row</p>
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
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={"How do I reset my API key?\nWhat's the rate limit on the free plan?\nCan I upgrade mid-billing cycle?"}
          className="w-full min-h-[200px] bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent-dim"
        />
      )}

      {count > 0 && (
        <p className="text-xs text-accent">
          {count} question{count !== 1 ? "s" : ""} · will be matched to documents during generation
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onSkip}
          className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors"
        >
          Skip
        </button>
        <button
          onClick={onNext}
          disabled={count === 0}
          className="px-3 py-1.5 text-xs rounded bg-accent-dim text-accent-bright hover:bg-accent/20 transition-colors disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
