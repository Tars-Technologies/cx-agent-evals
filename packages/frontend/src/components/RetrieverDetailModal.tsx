"use client";

import { useState } from "react";
import {
  INDEX_STRATEGY_REGISTRY,
  QUERY_STRATEGY_REGISTRY,
  SEARCH_STRATEGY_REGISTRY,
  REFINEMENT_STEP_REGISTRY,
  CHUNKER_REGISTRY,
  EMBEDDER_REGISTRY,
  RERANKER_REGISTRY,
} from "rag-evaluation-system/registry";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharingRetriever {
  name: string;
}

interface RetrieverDetailModalProps {
  retriever: {
    name: string;
    retrieverConfig: unknown;
    defaultK: number;
    status: string;
    chunkCount?: number;
    createdAt: number;
  };
  sharingRetrievers: SharingRetriever[];
  onDeleteIndex: () => void;
  onDeleteRetriever: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Parsed config shape (follows PipelineConfig + k)
// ---------------------------------------------------------------------------

interface ParsedConfig {
  name?: string;
  index?: {
    strategy?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    embeddingModel?: string;
    chunkerType?: string;
    childChunkSize?: number;
    parentChunkSize?: number;
    childOverlap?: number;
    parentOverlap?: number;
    contextPrompt?: string;
    summaryPrompt?: string;
    concurrency?: number;
    [key: string]: unknown;
  };
  query?: { strategy: string; [key: string]: unknown };
  search?: { strategy: string; [key: string]: unknown };
  refinement?: Array<{ type: string; [key: string]: unknown }>;
  k?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupName(
  registry: readonly { id: string; name: string }[],
  id: string,
): string {
  return registry.find((e) => e.id === id)?.name ?? id;
}

/** Format a value for display. Booleans become Yes/No, arrays join with commas. */
function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Format options record as key-value pairs, skipping empty/undefined values and known keys. */
function formatExtraOptions(
  opts: Record<string, unknown>,
  skipKeys: readonly string[],
): Array<{ label: string; value: string }> {
  return Object.entries(opts)
    .filter(
      ([k, v]) =>
        !skipKeys.includes(k) &&
        v !== "" &&
        v !== undefined &&
        v !== null,
    )
    .map(([k, v]) => ({ label: k, value: formatValue(v) }));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-text-dim w-28 shrink-0">{label}</span>
      <span className="text-xs text-text">{value}</span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h4 className="text-xs font-medium text-text uppercase tracking-wider mb-2">
      {title}
    </h4>
  );
}

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  configuring: { dot: "bg-text-dim", label: "Configuring", text: "text-text-dim" },
  indexing: { dot: "bg-accent animate-pulse", label: "Indexing", text: "text-accent" },
  ready: { dot: "bg-accent", label: "Ready", text: "text-accent" },
  error: { dot: "bg-red-500", label: "Error", text: "text-red-400" },
};

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function IndexSection({ config }: { config: ParsedConfig }) {
  const index = config.index;
  const strategy = index?.strategy ?? "plain";
  const isParentChild = strategy === "parent-child";

  const extraKeys = [
    "strategy",
    "chunkSize",
    "chunkOverlap",
    "embeddingModel",
    "chunkerType",
    "childChunkSize",
    "parentChunkSize",
    "childOverlap",
    "parentOverlap",
  ];
  const extras = index ? formatExtraOptions(index, extraKeys) : [];

  return (
    <section className="border border-border rounded-lg p-3 bg-bg-surface">
      <SectionHeader title="Index" />
      <div className="flex flex-col gap-1.5">
        <SummaryRow
          label="Strategy"
          value={lookupName(INDEX_STRATEGY_REGISTRY, strategy)}
        />
        {isParentChild ? (
          <>
            <SummaryRow
              label="Child Chunk"
              value={`${index?.childChunkSize ?? 200} chars`}
            />
            <SummaryRow
              label="Parent Chunk"
              value={`${index?.parentChunkSize ?? 1000} chars`}
            />
            <SummaryRow
              label="Child Overlap"
              value={`${index?.childOverlap ?? 0} chars`}
            />
            <SummaryRow
              label="Parent Overlap"
              value={`${index?.parentOverlap ?? 100} chars`}
            />
          </>
        ) : (
          <>
            <SummaryRow
              label="Chunk Size"
              value={`${index?.chunkSize ?? 1000} chars`}
            />
            <SummaryRow
              label="Chunk Overlap"
              value={`${index?.chunkOverlap ?? 200} chars`}
            />
          </>
        )}
        {index?.embeddingModel && (
          <SummaryRow label="Embedding" value={index.embeddingModel} />
        )}
        {extras.map(({ label, value }) => (
          <SummaryRow key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function QuerySection({ config }: { config: ParsedConfig }) {
  const query = config.query;
  const strategy = query?.strategy ?? "identity";
  const extraKeys = ["strategy"];
  const extras = query ? formatExtraOptions(query, extraKeys) : [];

  return (
    <section className="border border-border rounded-lg p-3 bg-bg-surface">
      <SectionHeader title="Query" />
      <div className="flex flex-col gap-1.5">
        <SummaryRow
          label="Strategy"
          value={lookupName(QUERY_STRATEGY_REGISTRY, strategy)}
        />
        {extras.map(({ label, value }) => (
          <SummaryRow key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function SearchSection({ config }: { config: ParsedConfig }) {
  const search = config.search;
  const strategy = search?.strategy ?? "dense";
  const k = config.k;
  const extraKeys = ["strategy"];
  const extras = search ? formatExtraOptions(search, extraKeys) : [];

  return (
    <section className="border border-border rounded-lg p-3 bg-bg-surface">
      <SectionHeader title="Search" />
      <div className="flex flex-col gap-1.5">
        <SummaryRow
          label="Strategy"
          value={lookupName(SEARCH_STRATEGY_REGISTRY, strategy)}
        />
        {extras.map(({ label, value }) => (
          <SummaryRow key={label} label={label} value={value} />
        ))}
        {k != null && <SummaryRow label="Top K" value={String(k)} />}
      </div>
    </section>
  );
}

function RefinementSection({ config }: { config: ParsedConfig }) {
  const steps = config.refinement;

  return (
    <section className="border border-border rounded-lg p-3 bg-bg-surface">
      <SectionHeader title="Refinement" />
      {!steps || steps.length === 0 ? (
        <p className="text-xs text-text-muted">None</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {steps.map((step, i) => {
            const extraKeys = ["type"];
            const extras = formatExtraOptions(step, extraKeys);
            return (
              <div key={`${step.type}-${i}`}>
                <SummaryRow
                  label={`Step ${i + 1}`}
                  value={lookupName(REFINEMENT_STEP_REGISTRY, step.type)}
                />
                {extras.map(({ label, value }) => (
                  <SummaryRow key={label} label={`  ${label}`} value={value} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// DangerZone
// ---------------------------------------------------------------------------

function DangerZone({
  retrieverName,
  status,
  sharingRetrievers,
  onDeleteIndex,
  onDeleteRetriever,
}: {
  retrieverName: string;
  status: string;
  sharingRetrievers: SharingRetriever[];
  onDeleteIndex: () => void;
  onDeleteRetriever: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState<
    null | "retriever" | "index"
  >(null);
  const hasIndex = status === "ready" || status === "error";

  return (
    <>
      <section className="border border-red-500/20 rounded-lg p-4 bg-red-500/[0.02]">
        <h4 className="text-xs font-medium text-red-400 uppercase tracking-wider mb-3">
          Danger Zone
        </h4>
        <div className="space-y-3">
          {hasIndex && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-text">Delete Index</p>
                <p className="text-[11px] text-text-dim">
                  Resets retriever to configuring — needs re-indexing
                </p>
              </div>
              <button
                onClick={() => setConfirmAction("index")}
                className="text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                Delete Index
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-text">Delete Retriever</p>
              <p className="text-[11px] text-text-dim">
                Permanently removes this retriever
              </p>
            </div>
            <button
              onClick={() => setConfirmAction("retriever")}
              className="text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              Delete Retriever
            </button>
          </div>
        </div>
      </section>

      {confirmAction && (
        <ConfirmDeleteModal
          action={confirmAction}
          retrieverName={retrieverName}
          sharingRetrievers={sharingRetrievers}
          hasIndex={hasIndex}
          onConfirm={() => {
            if (confirmAction === "index") {
              onDeleteIndex();
            } else {
              onDeleteRetriever();
            }
            setConfirmAction(null);
          }}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RetrieverDetailModal({
  retriever,
  sharingRetrievers,
  onDeleteIndex,
  onDeleteRetriever,
  onClose,
}: RetrieverDetailModalProps) {
  const config = (retriever.retrieverConfig ?? {}) as ParsedConfig;
  const status =
    STATUS_STYLES[retriever.status] ?? STATUS_STYLES.configuring;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-h-[80vh] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text">
            Retriever Configuration
          </h3>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg"
          >
            &times;
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Top info block */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">
                {retriever.name}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-medium ${status.text}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${status.dot}`}
                />
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-dim">
              {retriever.chunkCount != null && retriever.chunkCount > 0 && (
                <span>{retriever.chunkCount} chunks</span>
              )}
              <span>
                Created{" "}
                {new Date(retriever.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>

          {/* 4 config sections */}
          <IndexSection config={config} />
          <QuerySection config={config} />
          <SearchSection config={config} />
          <RefinementSection config={config} />

          {/* Danger Zone */}
          <DangerZone
            retrieverName={retriever.name}
            status={retriever.status}
            sharingRetrievers={sharingRetrievers}
            onDeleteIndex={onDeleteIndex}
            onDeleteRetriever={onDeleteRetriever}
          />
        </div>
      </div>
    </div>
  );
}
