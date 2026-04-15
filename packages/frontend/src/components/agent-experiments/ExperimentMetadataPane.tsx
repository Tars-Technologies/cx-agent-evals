"use client";

import { useState } from "react";

interface ToolCall {
  toolName: string;
  query: string;
  retrieverId?: string;
  chunks: Array<{ content: string; docId: string; start: number; end: number }>;
}

interface Chunk {
  content: string;
  docId: string;
  start: number;
  end: number;
}

interface GroundTruthSpan {
  start: number;
  end: number;
}

interface GroundTruthEntry {
  docId: string;
  spans: GroundTruthSpan[];
}

interface ExperimentMetadataPaneProps {
  result: {
    toolCalls: ToolCall[];
    retrievedChunks: Chunk[];
    scores?: Record<string, number>;
  } | null;
  question: {
    groundTruth?: GroundTruthEntry[];
  } | null;
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label =
    count !== undefined ? `${title} (${count})` : title;

  return (
    <div className="border border-border rounded-lg bg-bg-elevated">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-text-dim uppercase tracking-wider hover:text-text transition-colors"
      >
        <span>{label}</span>
        <span className="text-base">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export default function ExperimentMetadataPane({
  result,
  question,
}: ExperimentMetadataPaneProps) {
  if (!result) {
    return (
      <div className="flex flex-col h-full overflow-y-auto items-center justify-center">
        <span className="text-xs text-text-dim">Select a question to see details</span>
      </div>
    );
  }

  const { toolCalls, retrievedChunks, scores } = result;
  const groundTruth = question?.groundTruth;

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-2 p-3">
      {/* Header */}
      <div className="text-xs uppercase tracking-wider text-text-dim">Details</div>

      {/* Tool Calls */}
      <CollapsibleSection
        title="Tool Calls"
        count={toolCalls.length}
        defaultOpen={false}
      >
        {toolCalls.length === 0 ? (
          <div className="text-xs text-text-dim">No tool calls</div>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {toolCalls.map((tc, i) => (
              <div key={i} className="bg-bg-elevated rounded p-2">
                <div style={{ fontSize: "10px" }} className="text-accent font-medium mb-1">
                  {tc.toolName}
                </div>
                <div style={{ fontSize: "9px" }} className="text-text-dim">
                  {tc.query}
                </div>
                <div style={{ fontSize: "9px" }} className="text-text-dim mt-1">
                  {tc.chunks.length} chunk{tc.chunks.length !== 1 ? "s" : ""} returned
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Retrieved Chunks */}
      <CollapsibleSection
        title="Retrieved Chunks"
        count={retrievedChunks.length}
        defaultOpen={true}
      >
        {retrievedChunks.length === 0 ? (
          <div className="text-xs text-text-dim">No chunks retrieved</div>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {retrievedChunks.map((chunk, i) => (
              <div key={i} className="bg-bg-elevated rounded p-2">
                <div className="text-xs text-text-dim mb-1">
                  doc: {chunk.docId} | chars {chunk.start}–{chunk.end}
                </div>
                <div className="text-xs text-text-dim line-clamp-3">
                  {chunk.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Scores */}
      <CollapsibleSection
        title="Scores"
        count={scores ? Object.keys(scores).length : 0}
        defaultOpen={false}
      >
        {!scores || Object.keys(scores).length === 0 ? (
          <div className="text-xs text-text-dim pt-1">No scores available</div>
        ) : (
          <div className="flex flex-col gap-1 pt-1">
            {Object.entries(scores).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-text-dim uppercase tracking-wide">
                  {key === "iou" ? "IoU" : key}
                </span>
                <span className="text-accent font-medium">{value.toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Ground Truth */}
      <CollapsibleSection
        title="Ground Truth"
        count={
          groundTruth
            ? groundTruth.reduce((acc, gt) => acc + gt.spans.length, 0)
            : 0
        }
        defaultOpen={false}
      >
        {!groundTruth || groundTruth.length === 0 ? (
          <div className="text-xs text-text-dim pt-1">No ground truth available</div>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {groundTruth.map((gt, i) =>
              gt.spans.map((span, j) => (
                <div key={`${i}-${j}`} className="bg-bg-elevated rounded p-2">
                  <div className="text-xs text-text-dim">
                    doc: {gt.docId} | chars {span.start}–{span.end}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
