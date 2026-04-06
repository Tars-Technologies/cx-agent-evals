"use client";

import { CollapsibleSection } from "./CollapsibleSection";
import { TagsSection } from "./TagsSection";

interface MetadataPaneProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  result: any | null;
  question: any | null;
  annotation: any | null;
  allTags: string[];
}

export function MetadataPane({
  result,
  question,
  annotation,
  allTags,
}: MetadataPaneProps) {
  if (!result) return null;

  return (
    <div className="w-96 border-l border-border overflow-y-auto shrink-0 flex flex-col">
      {/* Tags */}
      <TagsSection
        resultId={result._id}
        currentTags={annotation?.tags ?? []}
        allTags={allTags}
        hasAnnotation={!!annotation}
      />

      {/* Scores + Retrieved Chunks + Tool Calls + Ground Truth */}
      <div className="p-4 space-y-2">
        {/* Scores — only when tool calls were made and scores exist */}
        {result.toolCalls.length > 0 && result.scores && (
          <CollapsibleSection
            title={`Scores (${Object.keys(result.scores).length})`}
          >
            <div className="space-y-2">
              {Object.entries(result.scores as Record<string, number>).map(
                ([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-text-dim uppercase tracking-wide">
                      {key === "iou" ? "IoU" : key}
                    </span>
                    <span className="text-accent font-medium">
                      {value.toFixed(3)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Retrieved Chunks */}
        <CollapsibleSection
          title={`Retrieved Chunks (${result.retrievedChunks.length})`}
        >
          {result.retrievedChunks.length === 0 ? (
            <div className="text-text-dim text-xs">No chunks retrieved.</div>
          ) : (
            <div className="space-y-2">
              {result.retrievedChunks.map((chunk: any, i: number) => (
                <div
                  key={i}
                  className="border border-border rounded p-3 text-xs"
                >
                  <div className="text-text-dim mb-1">
                    doc: {chunk.docId} | chars {chunk.start}-{chunk.end}
                  </div>
                  <div className="text-text whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {chunk.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Tool Calls */}
        <CollapsibleSection
          title={`Tool Calls (${result.toolCalls.length})`}
        >
          {result.toolCalls.length === 0 ? (
            <div className="text-text-dim text-xs">No tool calls.</div>
          ) : (
            <div className="space-y-3">
              {result.toolCalls.map((tc: any, i: number) => (
                <div
                  key={i}
                  className="border border-border rounded p-3 text-xs"
                >
                  <div className="font-medium text-text mb-1">
                    {tc.toolName}
                  </div>
                  <div className="text-text-dim">
                    Query: &quot;{tc.query}&quot;
                  </div>
                  <div className="text-text-dim mt-1">
                    {tc.chunks.length} chunks returned
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Ground Truth */}
        {question?.relevantSpans && (
          <CollapsibleSection
            title={`Ground Truth (${question.relevantSpans.length} spans)`}
          >
            <div className="space-y-2">
              {question.relevantSpans.map((span: any, i: number) => (
                <div
                  key={i}
                  className="border border-border rounded p-3 text-xs"
                >
                  <div className="text-text-dim mb-1">
                    doc: {span.docId} | chars {span.start}-{span.end}
                  </div>
                  <div className="text-text whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {span.text}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
