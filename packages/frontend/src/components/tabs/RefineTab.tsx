"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/lib/convex";
import { ChunkCard } from "@/components/ChunkCard";
import type { Id } from "@convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefineTabProps {
  retriever: {
    _id: Id<"retrievers">;
    retrieverConfig: any;
    defaultK: number;
    status: string;
  };
  query: string;
  onQueryChange: (query: string) => void;
}

interface ChunkResult {
  readonly chunkId: string;
  readonly content: string;
  readonly docId: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly metadata: Record<string, unknown>;
}

interface StageInfo {
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly outputChunks: ChunkResult[];
  readonly latencyMs: number;
}

interface PipelineResult {
  search: {
    fusedResults: ChunkResult[];
    searchConfig: Record<string, unknown>;
    latencyMs: number;
  };
  refinement: {
    stages: StageInfo[];
    finalChunks: ChunkResult[];
  };
}

/** A node in the stage pipeline stepper. */
interface StageNode {
  readonly label: string;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={`w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin ${className ?? ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Stage Pipeline Stepper
// ---------------------------------------------------------------------------

function StagePipelineStepper({
  stages,
  selectedIndex,
  onSelect,
}: {
  stages: StageNode[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((stage, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-text-dim text-xs select-none">{"\u2192"}</span>}
          <button
            type="button"
            onClick={() => onSelect(i)}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer ${
              i === selectedIndex
                ? "bg-accent text-bg font-medium"
                : "bg-bg-elevated text-text-dim border border-border hover:border-accent/30"
            }`}
          >
            {stage.label}({stage.count})
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage Info Banner
// ---------------------------------------------------------------------------

function StageInfoBanner({ stage }: { stage: StageInfo }) {
  const configEntries = Object.entries(stage.config).filter(
    ([key]) => key !== "type",
  );

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-2 text-[11px] text-text-dim">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>
          Type: <span className="text-text-muted">{stage.name}</span>
        </span>
        {configEntries.map(([key, value]) => (
          <span key={key}>
            {key}: <span className="text-text-muted">{String(value)}</span>
          </span>
        ))}
        <span>
          {stage.inputCount}{"\u2192"}{stage.outputCount}
        </span>
        <span>
          Latency: <span className="text-text-muted">{stage.latencyMs}ms</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage Detail
// ---------------------------------------------------------------------------

function StageDetail({
  stageNodes,
  selectedIndex,
  pipelineResult,
}: {
  stageNodes: StageNode[];
  selectedIndex: number;
  pipelineResult: PipelineResult;
}) {
  const { search, refinement } = pipelineResult;
  const isSearchStage = selectedIndex === 0;
  const isFinalStage =
    refinement.stages.length > 0 &&
    selectedIndex === refinement.stages.length + 1;
  const isRefinementStage = !isSearchStage && !isFinalStage;

  // Determine which chunks to show
  let displayChunks: ChunkResult[];
  if (isSearchStage) {
    displayChunks = search.fusedResults;
  } else if (isFinalStage) {
    displayChunks = refinement.finalChunks;
  } else {
    displayChunks = refinement.stages[selectedIndex - 1]?.outputChunks ?? [];
  }

  const stageLabel = stageNodes[selectedIndex]?.label ?? "Unknown";
  const chunkCount = displayChunks.length;

  // Get the refinement stage info (only for actual refinement stages, not search or final)
  const refinementStage = isRefinementStage
    ? refinement.stages[selectedIndex - 1] ?? null
    : null;

  return (
    <div className="space-y-3">
      {/* Stage header */}
      <div>
        <span className="text-[10px] text-text-dim uppercase tracking-wider">
          Stage: {stageLabel} ({chunkCount} chunk{chunkCount !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Stage info banner (non-search stages only) */}
      {refinementStage && <StageInfoBanner stage={refinementStage} />}

      {/* Search config banner (search stage only) */}
      {isSearchStage && (
        <div className="bg-bg-surface border border-border rounded-lg p-2 text-[11px] text-text-dim">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              Strategy:{" "}
              <span className="text-text-muted">
                {String(search.searchConfig.strategy ?? "dense")}
              </span>
            </span>
            {search.searchConfig.k != null && (
              <span>
                k:{" "}
                <span className="text-text-muted">
                  {String(search.searchConfig.k)}
                </span>
              </span>
            )}
            <span>
              Latency:{" "}
              <span className="text-text-muted">{search.latencyMs}ms</span>
            </span>
          </div>
        </div>
      )}

      {/* Chunk list */}
      {chunkCount === 0 ? (
        <div className="py-6 text-center text-xs text-text-dim">
          No chunks at this stage.
        </div>
      ) : (
        <div className="space-y-2">
          {displayChunks.map((chunk, i) => (
            <ChunkCard
              key={`${chunk.chunkId}-${i}`}
              rank={i + 1}
              score={chunk.score}
              docId={chunk.docId}
              start={chunk.start}
              end={chunk.end}
              content={chunk.content}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RefineTab({
  retriever,
  query,
  onQueryChange,
}: RefineTabProps) {
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(
    null,
  );
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewriteAction = useAction(
    api.retrieval.pipelineActions.rewriteQuery,
  );
  const searchAction = useAction(
    api.retrieval.pipelineActions.searchWithQueries,
  );
  const refineAction = useAction(api.retrieval.pipelineActions.refine);

  const handleRun = useCallback(async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const rewrite = await rewriteAction({
        retrieverId: retriever._id,
        query: query.trim(),
      });

      const search = (await searchAction({
        retrieverId: retriever._id,
        queries: (rewrite as any).rewrittenQueries,
        k: retriever.defaultK,
      })) as PipelineResult["search"];

      // refine takes the fused search results as input
      const refinement = (await refineAction({
        retrieverId: retriever._id,
        query: query.trim(),
        chunks: search.fusedResults,
        k: retriever.defaultK,
      })) as PipelineResult["refinement"];

      setPipelineResult({ search, refinement });
      setSelectedStageIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setIsLoading(false);
    }
  }, [
    query,
    retriever._id,
    retriever.defaultK,
    rewriteAction,
    searchAction,
    refineAction,
  ]);

  // Non-ready state
  if (retriever.status !== "ready") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-sm text-text-dim">
            This retriever hasn&apos;t been indexed yet.
          </p>
          <p className="text-[11px] text-text-dim/60">
            Start indexing from the retriever card to inspect the refinement
            pipeline.
          </p>
        </div>
      </div>
    );
  }

  // Build stage nodes from the pipeline result
  const stageNodes: StageNode[] = buildStageNodes(pipelineResult);

  return (
    <div className="flex flex-col h-full">
      {/* Query bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border flex-shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRun();
          }}
          placeholder="Enter a query to test the refinement pipeline..."
          className="flex-1 bg-bg-surface border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={!query.trim() || isLoading}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent/90 text-bg-elevated disabled:bg-border disabled:text-text-dim transition-colors cursor-pointer"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              Running
            </span>
          ) : (
            "Run"
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && !pipelineResult && (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Spinner />
            <span className="text-[11px] text-text-dim">
              Running pipeline...
            </span>
          </div>
        )}

        {!isLoading && !pipelineResult && (
          <div className="flex items-center justify-center h-full text-xs text-text-dim px-4 text-center">
            Run a query to see the refinement pipeline stages.
          </div>
        )}

        {pipelineResult && (
          <div className="p-3 space-y-4">
            {/* Stage pipeline stepper */}
            {stageNodes.length > 0 && (
              <div className="bg-bg-surface border border-border rounded-lg p-3">
                <StagePipelineStepper
                  stages={stageNodes}
                  selectedIndex={selectedStageIndex}
                  onSelect={setSelectedStageIndex}
                />
              </div>
            )}

            {/* No refinement message */}
            {pipelineResult.refinement.stages.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-dim italic">
                No refinement stages configured. Search results are the final
                output.
              </div>
            )}

            {/* Stage detail area */}
            <StageDetail
              stageNodes={stageNodes}
              selectedIndex={selectedStageIndex}
              pipelineResult={pipelineResult}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an array of stage nodes for the pipeline stepper.
 *
 * Index 0 = "Search Input" with the fused results count.
 * Index 1..N = Each refinement stage from `refinement.stages`.
 * Last = "Final" (same as last stage output, or search input if no refinement).
 *
 * When there are no refinement stages, we show a single "Search Input" node.
 */
function buildStageNodes(result: PipelineResult | null): StageNode[] {
  if (!result) return [];

  const nodes: StageNode[] = [];

  // Search input node
  nodes.push({
    label: "Search Input",
    count: result.search.fusedResults.length,
  });

  // Refinement stage nodes
  for (const stage of result.refinement.stages) {
    nodes.push({
      label: capitalize(stage.name),
      count: stage.outputCount,
    });
  }

  // "Final" node (only add if there is at least one refinement stage,
  // and it differs from the last stage — which it always does conceptually)
  if (result.refinement.stages.length > 0) {
    const lastStage =
      result.refinement.stages[result.refinement.stages.length - 1];
    nodes.push({
      label: "Final",
      count: lastStage.outputCount,
    });
  }

  return nodes;
}

function capitalize(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
