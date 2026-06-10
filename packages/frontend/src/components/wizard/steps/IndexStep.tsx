"use client"

import {
  CHUNKER_REGISTRY,
  EMBEDDER_REGISTRY,
  INDEX_STRATEGY_REGISTRY
} from "@tars-inc/eval-lib/registry"
import {
  gateEmbedderEntry,
  isEmbedderAllowed,
  VECTOR_BACKEND_CHOICES,
  type VectorBackendChoice
} from "@/lib/vectorBackendGating"
import { OptionGroup } from "../shared/OptionGroup"
import { StrategyCard } from "../shared/StrategyCard"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexStepProps {
  indexStrategy: string
  chunkerType: string
  chunkerOptions: Record<string, unknown>
  embedderProvider: string
  embedderOptions: Record<string, unknown>
  vectorBackend: string
  onIndexStrategyChange: (strategy: string) => void
  onChunkerChange: (type: string, options: Record<string, unknown>) => void
  onEmbedderChange: (provider: string, options: Record<string, unknown>) => void
  onVectorBackendChange: (backend: string) => void
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
  vectorBackend,
  onIndexStrategyChange,
  onChunkerChange,
  onEmbedderChange,
  onVectorBackendChange
}: IndexStepProps) {
  const selectedChunker = CHUNKER_REGISTRY.find((c) => c.id === chunkerType)
  const selectedEmbedder = EMBEDDER_REGISTRY.find(
    (e) => e.id === embedderProvider
  )

  const backend = (
    vectorBackend === "qdrant" ? "qdrant" : "native"
  ) as VectorBackendChoice
  const gatedEmbedder = selectedEmbedder
    ? gateEmbedderEntry(selectedEmbedder, backend)
    : undefined

  const handleChunkerSelect = (id: string) => {
    const entry = CHUNKER_REGISTRY.find((c) => c.id === id)
    if (entry && entry.status === "available") {
      onChunkerChange(id, { ...entry.defaults })
    }
  }

  const handleChunkerOptionChange = (key: string, value: unknown) => {
    onChunkerChange(chunkerType, { ...chunkerOptions, [key]: value })
  }

  const handleEmbedderSelect = (id: string) => {
    const entry = EMBEDDER_REGISTRY.find((e) => e.id === id)
    if (entry) {
      onEmbedderChange(id, { ...entry.defaults })
    }
  }

  const handleEmbedderOptionChange = (key: string, value: unknown) => {
    onEmbedderChange(embedderProvider, { ...embedderOptions, [key]: value })
  }

  const selectClass =
    "w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 " +
    "focus:outline-none focus:border-accent/50 transition-colors cursor-pointer"

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

      {/* ---- Vector Store ---- */}
      <section>
        <h3 className="text-sm font-medium text-text mb-3">Vector Store</h3>

        <select
          value={vectorBackend}
          onChange={(e) => onVectorBackendChange(e.target.value)}
          className={selectClass}
        >
          {VECTOR_BACKEND_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-xs text-text-muted">
          {VECTOR_BACKEND_CHOICES.find((c) => c.id === backend)?.description}
        </p>
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
              disabled={!isEmbedderAllowed(entry, backend)}
            >
              {entry.name}
              {entry.status === "coming-soon" ? " (coming soon)" : ""}
              {entry.status === "unavailable" ? " (unavailable)" : ""}
              {entry.status === "available" &&
              !isEmbedderAllowed(entry, backend)
                ? " (qdrant only)"
                : ""}
            </option>
          ))}
        </select>

        {gatedEmbedder && gatedEmbedder.description && (
          <p className="mt-1.5 text-xs text-text-muted">
            {gatedEmbedder.description}
          </p>
        )}

        {gatedEmbedder && gatedEmbedder.options.length > 0 && (
          <div className="mt-4">
            <OptionGroup
              options={gatedEmbedder.options}
              values={embedderOptions}
              onChange={handleEmbedderOptionChange}
            />
          </div>
        )}
      </section>
    </div>
  )
}
