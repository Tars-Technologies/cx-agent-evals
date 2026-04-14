"use client";

import { useState, useCallback, useEffect } from "react";
import type { Dimension } from "@/lib/types";

const DISCOVER_URL_PREFIX = "rag-eval:dimension-discover-url:";
const discoverUrlKey = (kbId: string) => `${DISCOVER_URL_PREFIX}${kbId}`;

interface WizardStepDimensionsProps {
  kbId: string;
  dimensions: Dimension[];
  onChange: (dimensions: Dimension[]) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

export function WizardStepDimensions({ kbId, dimensions, onChange, onNext, onSkip, onBack }: WizardStepDimensionsProps) {
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(discoverUrlKey(kbId)) ?? ""; }
    catch { return ""; }
  });

  useEffect(() => {
    try {
      setUrl(localStorage.getItem(discoverUrlKey(kbId)) ?? "");
    } catch {
      setUrl("");
    }
  }, [kbId]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newValueInputs, setNewValueInputs] = useState<Record<number, string>>({});

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
      if (!res.ok) { setError(data.error || "Discovery failed"); return; }
      onChange(data.dimensions);
      try { localStorage.setItem(discoverUrlKey(kbId), url); } catch {}
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to discover");
    } finally {
      setDiscovering(false);
    }
  }, [url, onChange, kbId]);

  const addDimension = () => {
    onChange([...dimensions, { name: "", description: "", values: [] }]);
  };

  const removeDimension = (idx: number) => {
    onChange(dimensions.filter((_, i) => i !== idx));
  };

  const updateDimension = (idx: number, updates: Partial<Dimension>) => {
    onChange(dimensions.map((d, i) => (i === idx ? { ...d, ...updates } : d)));
  };

  const addValue = (dimIdx: number) => {
    const val = (newValueInputs[dimIdx] ?? "").trim();
    if (!val) return;
    const dim = dimensions[dimIdx];
    if (dim.values.includes(val)) return;
    onChange(dimensions.map((d, i) =>
      i === dimIdx ? { ...d, values: [...d.values, val] } : d,
    ));
    setNewValueInputs((prev) => ({ ...prev, [dimIdx]: "" }));
  };

  const removeValue = (dimIdx: number, valIdx: number) => {
    onChange(dimensions.map((d, i) =>
      i === dimIdx ? { ...d, values: d.values.filter((_, vi) => vi !== valIdx) } : d,
    ));
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <span className="text-xs text-text-dim uppercase tracking-wider">Diversity Dimensions</span>
        <p className="text-xs text-text-dim mt-1">
          Auto-discover user personas and question types from your product URL, or add manually.
        </p>
      </div>

      {/* URL discover */}
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-product.com/docs"
          className="flex-1 bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent-dim"
        />
        <button
          onClick={handleDiscover}
          disabled={discovering || !url.trim()}
          className="px-3 py-1.5 text-xs rounded bg-accent-dim text-accent-bright hover:bg-accent/20 transition-colors disabled:opacity-40"
        >
          {discovering ? "Discovering..." : "Discover"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Dimension cards */}
      {dimensions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dimensions.map((dim, di) => (
            <div key={di} className="p-3 border border-border rounded space-y-2">
              <div className="flex items-center justify-between">
                <input
                  placeholder="Dimension name"
                  value={dim.name}
                  onChange={(e) => updateDimension(di, { name: e.target.value })}
                  className="flex-1 bg-transparent text-xs font-medium text-text placeholder:text-text-dim/40
                             border-b border-border/50 pb-1 focus:outline-none focus:border-accent/50 transition-colors"
                />
                <button onClick={() => removeDimension(di)} className="text-xs text-text-dim hover:text-red-400 ml-2">×</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {dim.values.map((val, vi) => (
                  <span key={vi} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-bg-secondary border border-border text-text-dim">
                    {val}
                    <button onClick={() => removeValue(di, vi)} className="hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
              {/* Add value input */}
              <div className="flex gap-1.5">
                <input
                  placeholder="Add value..."
                  value={newValueInputs[di] ?? ""}
                  onChange={(e) => setNewValueInputs((prev) => ({ ...prev, [di]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addValue(di); }
                  }}
                  className="flex-1 bg-bg-secondary border border-border/50 rounded px-2 py-1 text-[11px] text-text
                             placeholder:text-text-dim/30 focus:outline-none focus:border-accent/40 transition-colors"
                />
                <button
                  onClick={() => addValue(di)}
                  disabled={!(newValueInputs[di] ?? "").trim()}
                  className="px-2 py-1 rounded border border-border/50 text-[10px] text-text-dim
                             hover:border-accent/30 hover:text-accent transition-all cursor-pointer
                             disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add dimension button */}
      <button
        onClick={addDimension}
        className="w-full py-2 rounded border border-dashed border-border text-xs text-text-dim
                   hover:border-accent/30 hover:text-accent transition-all cursor-pointer"
      >
        + Add Dimension
      </button>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors">← Back</button>
        <div className="flex gap-2">
          <button onClick={onSkip} className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors">Skip</button>
          <button onClick={onNext} disabled={dimensions.length === 0} className="px-3 py-1.5 text-xs rounded bg-accent-dim text-accent-bright hover:bg-accent/20 transition-colors disabled:opacity-40">Next →</button>
        </div>
      </div>
    </div>
  );
}
