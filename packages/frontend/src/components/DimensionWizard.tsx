"use client";

import { useState, useCallback } from "react";
import { Dimension } from "@/lib/types";

interface DimensionWizardProps {
  initialDimensions?: Dimension[];
  initialTotalQuestions?: number;
  initialStep?: number;
  onSave: (dimensions: Dimension[], totalQuestions: number) => void;
  onClose: () => void;
}

export function DimensionWizard({
  initialDimensions,
  initialTotalQuestions = 50,
  initialStep = 1,
  onSave,
  onClose,
}: DimensionWizardProps) {
  const [step, setStep] = useState(initialStep);
  const [dimensions, setDimensions] = useState<Dimension[]>(
    initialDimensions ?? [],
  );
  const [totalQuestions, setTotalQuestions] = useState(initialTotalQuestions);
  const [url, setUrl] = useState(() => {
    try {
      return localStorage.getItem("rag-eval:dimension-discover-url") ?? "";
    } catch {
      return "";
    }
  });
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Set<number>>(
    new Set(),
  );

  const handleDiscover = useCallback(async () => {
    if (!url.trim()) return;
    setDiscovering(true);
    setError(null);

    try {
      const res = await fetch("/api/discover-dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Discovery failed");
        return;
      }

      setDimensions(data.dimensions);
      try {
        localStorage.setItem("rag-eval:dimension-discover-url", url);
      } catch {
        // localStorage full or unavailable
      }
      setStep(2);
    } catch {
      setError("Connection failed — check server");
    } finally {
      setDiscovering(false);
    }
  }, [url]);

  function handleSkip() {
    setDimensions([
      { name: "", description: "", values: [] },
    ]);
    setStep(2);
  }

  function validateAndAdvance() {
    const errors = new Set<number>();
    dimensions.forEach((dim, i) => {
      if (!dim.name.trim() || dim.values.length < 2) {
        errors.add(i);
      }
    });
    setValidationErrors(errors);
    if (errors.size === 0) {
      setStep(3);
    }
  }

  function updateDimension(index: number, updates: Partial<Dimension>) {
    setDimensions((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...updates } : d)),
    );
    setValidationErrors((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }

  function addValue(dimIndex: number, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDimensions((prev) =>
      prev.map((d, i) =>
        i === dimIndex && !d.values.includes(trimmed)
          ? { ...d, values: [...d.values, trimmed] }
          : d,
      ),
    );
  }

  function removeValue(dimIndex: number, valIndex: number) {
    setDimensions((prev) =>
      prev.map((d, i) =>
        i === dimIndex
          ? { ...d, values: d.values.filter((_, vi) => vi !== valIndex) }
          : d,
      ),
    );
  }

  function addDimension() {
    setDimensions((prev) => [
      ...prev,
      { name: "", description: "", values: [] },
    ]);
  }

  function removeDimension(index: number) {
    setDimensions((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    const filtered = dimensions.filter(
      (d) => d.name.trim() && d.values.length >= 2,
    );
    if (filtered.length === 0) return;
    onSave(filtered, totalQuestions);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col bg-bg-elevated border border-border rounded-lg shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-text">
              Dimension Setup
            </h2>
            <div className="flex items-center gap-3 mt-2">
              {[1, 2, 3].map((s) => {
                const isCompleted = s < step;
                const isCurrent = s === step;
                const canClick = isCompleted; // Can only click completed steps

                return (
                  <div
                    key={s}
                    className={`flex items-center gap-1.5 ${canClick ? "cursor-pointer" : ""}`}
                    onClick={canClick ? () => setStep(s) : undefined}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                        isCurrent
                          ? "bg-accent text-bg"
                          : isCompleted
                            ? "bg-accent/20 text-accent"
                            : "bg-bg-surface text-text-muted"
                      }`}
                    >
                      {isCompleted ? "✓" : s}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        isCurrent || isCompleted ? "text-accent" : "text-text-dim"
                      }`}
                    >
                      {s === 1 ? "Discover" : s === 2 ? "Edit" : "Configure"}
                    </span>
                    {s < 3 && (
                      <span className="w-4 h-px bg-border mx-1" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors cursor-pointer text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <Step1
              url={url}
              onUrlChange={setUrl}
              onDiscover={handleDiscover}
              onSkip={handleSkip}
              discovering={discovering}
              error={error}
            />
          )}
          {step === 2 && (
            <Step2
              dimensions={dimensions}
              validationErrors={validationErrors}
              onUpdate={updateDimension}
              onAddValue={addValue}
              onRemoveValue={removeValue}
              onAdd={addDimension}
              onRemove={removeDimension}
            />
          )}
          {step === 3 && (
            <Step3
              dimensions={dimensions}
              totalQuestions={totalQuestions}
              onTotalChange={setTotalQuestions}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-1.5 rounded border border-border text-xs text-text-muted
                           hover:border-accent/30 hover:text-text transition-all cursor-pointer"
              >
                Back
              </button>
            )}
          </div>
          <div>
            {step === 1 && (
              <button
                onClick={handleDiscover}
                disabled={!url.trim() || discovering}
                className="px-4 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider
                           transition-all cursor-pointer
                           disabled:opacity-30 disabled:cursor-not-allowed
                           bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
              >
                {discovering ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
                    Analyzing...
                  </span>
                ) : (
                  "Discover"
                )}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={validateAndAdvance}
                disabled={dimensions.length === 0}
                className="px-4 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider
                           transition-all cursor-pointer
                           disabled:opacity-30 disabled:cursor-not-allowed
                           bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSave}
                className="px-4 py-1.5 rounded border text-xs font-semibold uppercase tracking-wider
                           transition-all cursor-pointer
                           bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
              >
                Save &amp; Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 1: Discovery ─── */

function Step1({
  url,
  onUrlChange,
  onDiscover,
  onSkip,
  discovering,
  error,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onDiscover: () => void;
  onSkip: () => void;
  discovering: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <p className="text-xs text-text-muted mb-4">
          Enter your company&apos;s website URL to auto-discover question
          dimensions based on your product, users, and content.
        </p>
        <label className="block text-[11px] text-text-muted mb-1">
          Website URL
        </label>
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim() && !discovering) onDiscover();
          }}
          disabled={discovering}
          className="w-full bg-bg-surface border border-border rounded px-3 py-2 text-sm text-text
                     placeholder:text-text-dim/40
                     focus:outline-none focus:border-accent/50 transition-colors
                     disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="p-2.5 rounded border border-error/30 bg-error/5">
          <p className="text-[11px] text-error">{error}</p>
        </div>
      )}

      {discovering && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
          Fetching website and analyzing content...
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={onSkip}
          disabled={discovering}
          className="text-[11px] text-text-dim hover:text-accent transition-colors cursor-pointer"
        >
          Skip &mdash; define dimensions manually
        </button>
      </div>
    </div>
  );
}

/* ─── Step 2: Review & Edit ─── */

function Step2({
  dimensions,
  validationErrors,
  onUpdate,
  onAddValue,
  onRemoveValue,
  onAdd,
  onRemove,
}: {
  dimensions: Dimension[];
  validationErrors: Set<number>;
  onUpdate: (index: number, updates: Partial<Dimension>) => void;
  onAddValue: (dimIndex: number, value: string) => void;
  onRemoveValue: (dimIndex: number, valIndex: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-xs text-text-muted mb-2">
        Review and edit the discovered dimensions. Each needs a name and at
        least 2 values.
      </p>

      {dimensions.map((dim, i) => (
        <DimensionCard
          key={i}
          dimension={dim}
          index={i}
          hasError={validationErrors.has(i)}
          onUpdate={(updates) => onUpdate(i, updates)}
          onAddValue={(val) => onAddValue(i, val)}
          onRemoveValue={(vi) => onRemoveValue(i, vi)}
          onRemove={() => onRemove(i)}
        />
      ))}

      <button
        onClick={onAdd}
        className="w-full py-2 rounded border border-dashed border-border text-xs text-text-dim
                   hover:border-accent/30 hover:text-accent transition-all cursor-pointer"
      >
        + Add Dimension
      </button>
    </div>
  );
}

function DimensionCard({
  dimension,
  index,
  hasError,
  onUpdate,
  onAddValue,
  onRemoveValue,
  onRemove,
}: {
  dimension: Dimension;
  index: number;
  hasError: boolean;
  onUpdate: (updates: Partial<Dimension>) => void;
  onAddValue: (value: string) => void;
  onRemoveValue: (valIndex: number) => void;
  onRemove: () => void;
}) {
  const [newValue, setNewValue] = useState("");

  function handleAddValue() {
    if (newValue.trim()) {
      onAddValue(newValue);
      setNewValue("");
    }
  }

  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${
        hasError
          ? "border-error/40 bg-error/3"
          : "border-border bg-bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 space-y-2">
          <input
            placeholder="Dimension name"
            value={dimension.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="w-full bg-transparent border-b border-border/50 text-xs font-semibold text-text
                       placeholder:text-text-dim/40 pb-1
                       focus:outline-none focus:border-accent/50 transition-colors"
          />
          <input
            placeholder="Description (optional)"
            value={dimension.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="w-full bg-transparent border-b border-border/30 text-[11px] text-text-muted
                       placeholder:text-text-dim/30 pb-1
                       focus:outline-none focus:border-accent/30 transition-colors"
          />
        </div>
        <button
          onClick={onRemove}
          className="text-text-dim hover:text-error transition-colors cursor-pointer text-xs mt-1"
          title="Remove dimension"
        >
          &times;
        </button>
      </div>

      {/* Value tags */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {dimension.values.map((val, vi) => (
          <span
            key={vi}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]
                       bg-accent/8 border border-accent/20 text-accent/80"
          >
            {val}
            <button
              onClick={() => onRemoveValue(vi)}
              className="hover:text-error transition-colors cursor-pointer leading-none"
            >
              &times;
            </button>
          </span>
        ))}
      </div>

      {/* Add value input */}
      <div className="flex gap-1.5">
        <input
          placeholder="Add value..."
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddValue();
            }
          }}
          className="flex-1 bg-bg/50 border border-border/50 rounded px-2 py-1 text-[11px] text-text
                     placeholder:text-text-dim/30
                     focus:outline-none focus:border-accent/40 transition-colors"
        />
        <button
          onClick={handleAddValue}
          disabled={!newValue.trim()}
          className="px-2 py-1 rounded border border-border/50 text-[10px] text-text-muted
                     hover:border-accent/30 hover:text-accent transition-all cursor-pointer
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>

      {hasError && (
        <p className="text-[10px] text-error mt-1.5">
          {!dimension.name.trim()
            ? "Name is required"
            : "At least 2 values required"}
        </p>
      )}
    </div>
  );
}

/* ─── Step 3: Configure & Save ─── */

function Step3({
  dimensions,
  totalQuestions,
  onTotalChange,
}: {
  dimensions: Dimension[];
  totalQuestions: number;
  onTotalChange: (n: number) => void;
}) {
  const totalValues = dimensions.reduce((sum, d) => sum + d.values.length, 0);
  const validDimensions = dimensions.filter(
    (d) => d.name.trim() && d.values.length >= 2,
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <span className="text-[11px] text-text-muted uppercase tracking-wider">
          Summary
        </span>
        <div className="mt-2 p-3 rounded-lg border border-border bg-bg-surface">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">Dimensions</span>
            <span className="text-xs text-text font-semibold">
              {validDimensions.length}
            </span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-muted">Total values</span>
            <span className="text-xs text-text font-semibold">
              {totalValues}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {validDimensions.map((dim) => (
              <span
                key={dim.name}
                className="px-2 py-0.5 rounded text-[10px] bg-accent/8 border border-accent/20 text-accent/80"
              >
                {dim.name}
                <span className="text-accent/40 ml-1">
                  ({dim.values.length})
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">
          Total questions to generate
        </label>
        <input
          type="number"
          min={1}
          value={totalQuestions}
          onChange={(e) => onTotalChange(parseInt(e.target.value) || 1)}
          className="w-full bg-bg-surface border border-border rounded px-3 py-1.5 text-sm text-text
                     focus:outline-none focus:border-accent/50 transition-colors"
        />
        <p className="text-[10px] text-text-dim mt-1">
          Questions will be distributed across documents using stratified
          sampling to maximize dimension and document coverage.
        </p>
      </div>
    </div>
  );
}
