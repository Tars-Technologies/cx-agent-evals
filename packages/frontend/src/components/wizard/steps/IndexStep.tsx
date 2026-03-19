"use client";

import {
  INDEX_STRATEGY_REGISTRY,
  CHUNKER_REGISTRY,
  EMBEDDER_REGISTRY,
} from "rag-evaluation-system/registry";
import { StrategyCard } from "../shared/StrategyCard";
import { OptionGroup } from "../shared/OptionGroup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexStepProps {
  indexStrategy: string;
  chunkerType: string;
  chunkerOptions: Record<string, unknown>;
  embedderProvider: string;
  embedderOptions: Record<string, unknown>;
  onIndexStrategyChange: (strategy: string) => void;
  onChunkerChange: (type: string, options: Record<string, unknown>) => void;
  onEmbedderChange: (provider: string, options: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IndexStep({
  indexStrategy,
  chunkerType,
  chunkerOptions,
  embedderProvider,
  embedderOptions,
  onIndexStrategyChange,
  onChunkerChange,
  onEmbedderChange,
}: IndexStepProps) {
  const selectedChunker = CHUNKER_REGISTRY.find((c) => c.id === chunkerType);
  const selectedEmbedder = EMBEDDER_REGISTRY.find((e) => e.id === embedderProvider);

  const handleChunkerSelect = (id: string) => {
    const entry = CHUNKER_REGISTRY.find((c) => c.id === id);
    if (entry && entry.status === "available") {
      onChunkerChange(id, { ...entry.defaults });
    }
  };

  const handleChunkerOptionChange = (key: string, value: unknown) => {
    onChunkerChange(chunkerType, { ...chunkerOptions, [key]: value });
  };

  const handleEmbedderSelect = (id: string) => {
    const entry = EMBEDDER_REGISTRY.find((e) => e.id === id);
    if (entry) {
      onEmbedderChange(id, { ...entry.defaults });
    }
  };

  const handleEmbedderOptionChange = (key: string, value: unknown) => {
    onEmbedderChange(embedderProvider, { ...embedderOptions, [key]: value });
  };

  const selectClass =
    "w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 " +
    "focus:outline-none focus:border-accent/50 transition-colors cursor-pointer";

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Index Strategy ---- */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Index Strategy</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {INDEX_STRATEGY_REGISTRY.map((entry) => (
            <StrategyCard
              key={entry.id}
              id={entry.id}
              name={entry.name}
              description={entry.description}
              status={entry.status}
              selected={indexStrategy === entry.id}
              onSelect={onIndexStrategyChange}
              tags={entry.tags}
            />
          ))}
        </div>
      </section>

      {/* ---- Chunker ---- */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Chunker</h3>

        <select
          value={chunkerType}
          onChange={(e) => handleChunkerSelect(e.target.value)}
          className={selectClass}
        >
          {CHUNKER_REGISTRY.map((entry) => (
            <option
              key={entry.id}
              value={entry.id}
              disabled={entry.status === "coming-soon"}
            >
              {entry.name}
              {entry.status === "coming-soon" ? " (coming soon)" : ""}
            </option>
          ))}
        </select>

        {selectedChunker && selectedChunker.description && (
          <p className="mt-1.5 text-xs text-text-muted">
            {selectedChunker.description}
          </p>
        )}

        {selectedChunker && selectedChunker.options.length > 0 && (
          <div className="mt-4">
            <OptionGroup
              options={selectedChunker.options}
              values={chunkerOptions}
              onChange={handleChunkerOptionChange}
              disabled={selectedChunker.status === "coming-soon"}
            />
          </div>
        )}
      </section>

      {/* ---- Embedder ---- */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Embedder</h3>

        <select
          value={embedderProvider}
          onChange={(e) => handleEmbedderSelect(e.target.value)}
          className={selectClass}
        >
          {EMBEDDER_REGISTRY.map((entry) => (
            <option
              key={entry.id}
              value={entry.id}
              disabled={entry.status === "coming-soon"}
            >
              {entry.name}
              {entry.status === "coming-soon" ? " (coming soon)" : ""}
            </option>
          ))}
        </select>

        {selectedEmbedder && selectedEmbedder.description && (
          <p className="mt-1.5 text-xs text-text-muted">
            {selectedEmbedder.description}
          </p>
        )}

        {selectedEmbedder && selectedEmbedder.options.length > 0 && (
          <div className="mt-4">
            <OptionGroup
              options={selectedEmbedder.options}
              values={embedderOptions}
              onChange={handleEmbedderOptionChange}
            />
          </div>
        )}
      </section>
    </div>
  );
}
