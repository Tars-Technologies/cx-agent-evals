"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useQuery } from "convex/react"
import { type ReactNode, useMemo, useState } from "react"
import { api } from "@/lib/convex"
import { CollapsibleSection } from "./CollapsibleSection"
import { TagsSection } from "./TagsSection"

interface MetadataPaneProps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  result: any | null
  question: any | null
  annotation: any | null
  allTags: string[]
  kbId: Id<"knowledgeBases"> | null | undefined
}

/** Wraps an image-id badge; on hover, shows a floating pixel preview near the cursor. */
function ImageHoverPreview({
  url,
  alt,
  children
}: {
  url?: string
  alt?: string
  children: ReactNode
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setPos({ x: rect.left, y: rect.top })
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && url && (
        <div
          className="fixed z-[100] pointer-events-none border border-border rounded-lg bg-bg-elevated shadow-2xl p-1.5"
          style={{
            left: Math.max(8, pos.x - 216),
            top: Math.max(8, pos.y - 8)
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt ?? ""}
            className="max-w-[200px] max-h-[200px] rounded object-contain"
          />
          {alt && (
            <div className="max-w-[200px] mt-1 text-[10px] text-text-dim truncate">
              {alt}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MetadataPane({
  result,
  question,
  annotation,
  allTags,
  kbId
}: MetadataPaneProps) {
  const media = useQuery(
    api.kb.images.listMediaForKb,
    kbId ? { kbId } : "skip"
  )
  const mediaById = useMemo(() => {
    const map = new Map<string, { url?: string; alt: string }>()
    for (const m of media ?? []) map.set(m.imageId, { url: m.url, alt: m.alt })
    return map
  }, [media])

  if (!result) return null

  return (
    <div className="w-96 border-l border-border overflow-y-auto shrink-0 flex flex-col">
      {/* Tags */}
      <TagsSection
        resultId={result._id}
        currentTags={annotation?.tags ?? []}
        allTags={allTags}
        hasAnnotation={!!annotation}
      />

      {/* Retrieved Chunks + Tool Calls + Ground Truth + Scores */}
      <div className="p-4 space-y-2">
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
        <CollapsibleSection title={`Tool Calls (${result.toolCalls.length})`}>
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

        {/* Images — ground truth vs. menu offered vs. what the agent rendered */}
        {(question?.relevantImageIds?.length > 0 ||
          result.offeredImageIds?.length > 0 ||
          result.shownImages?.length > 0) && (
          <CollapsibleSection
            title={`Images (${result.offeredImageIds?.length ?? 0} offered)`}
          >
            <div className="space-y-3 text-xs">
              {question?.relevantImageIds?.length > 0 && (
                <div>
                  <div className="text-text-dim uppercase tracking-wide mb-1">
                    Ground truth ({question.relevantImageIds.length})
                  </div>
                  <div className="space-y-1">
                    {question.relevantImageIds.map((id: string) => {
                      const wasOffered = (
                        result.offeredImageIds ?? []
                      ).includes(id)
                      const m = mediaById.get(id)
                      return (
                        <ImageHoverPreview key={id} url={m?.url} alt={m?.alt}>
                          <div
                            className={`px-2 py-1 rounded border cursor-default ${
                              wasOffered
                                ? "border-accent/30 text-accent"
                                : "border-red-500/30 text-red-400"
                            }`}
                          >
                            {id} {wasOffered ? "— offered" : "— missed"}
                          </div>
                        </ImageHoverPreview>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-text-dim uppercase tracking-wide mb-1">
                  Menu offered ({result.offeredImageIds?.length ?? 0})
                </div>
                {result.offeredImageIds?.length > 0 ? (
                  <div className="space-y-1">
                    {result.offeredImageIds.map((id: string) => {
                      const isGroundTruth = (
                        question?.relevantImageIds ?? []
                      ).includes(id)
                      const m = mediaById.get(id)
                      return (
                        <ImageHoverPreview key={id} url={m?.url} alt={m?.alt}>
                          <div
                            className={`px-2 py-1 rounded border border-border cursor-default ${
                              isGroundTruth ? "text-accent" : "text-text-dim"
                            }`}
                          >
                            {id} {isGroundTruth ? "— relevant" : "— noise"}
                          </div>
                        </ImageHoverPreview>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-text-dim">No images offered.</div>
                )}
              </div>

              {result.shownImages?.length > 0 && (
                <div>
                  <div className="text-text-dim uppercase tracking-wide mb-1">
                    Rendered by agent ({result.shownImages.length})
                  </div>
                  <div className="space-y-1">
                    {result.shownImages.map(
                      (img: { imageId: string; alt: string; url?: string }) => (
                        <ImageHoverPreview
                          key={img.imageId}
                          url={img.url ?? mediaById.get(img.imageId)?.url}
                          alt={img.alt}
                        >
                          <div className="px-2 py-1 rounded border border-purple-500/30 text-purple-300 cursor-default">
                            {img.imageId} — {img.alt || "(no alt)"}
                          </div>
                        </ImageHoverPreview>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Scores — last to avoid biasing annotation; only when tool calls exist */}
        {result.toolCalls.length > 0 &&
          result.scores &&
          (() => {
            const scores = result.scores as Record<string, number>
            const textEntries = Object.entries(scores).filter(
              ([key]) => !key.startsWith("image_")
            )
            const imageEntries = Object.entries(scores).filter(([key]) =>
              key.startsWith("image_")
            )
            return (
              <CollapsibleSection
                title={`Scores (${Object.keys(scores).length})`}
              >
                <div className="space-y-4">
                  {textEntries.length > 0 && (
                    <div>
                      <div className="text-text-dim uppercase tracking-wide text-[10px] mb-1.5">
                        Text
                      </div>
                      <div className="space-y-2">
                        {textEntries.map(([key, value]) => (
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
                        ))}
                      </div>
                    </div>
                  )}

                  {imageEntries.length > 0 && (
                    <div>
                      <div className="text-text-dim uppercase tracking-wide text-[10px] mb-1.5">
                        Images
                      </div>
                      <div className="space-y-2">
                        {imageEntries.map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-text-dim uppercase tracking-wide">
                              {key.replace("image_", "")}
                            </span>
                            <span className="text-purple-300 font-medium">
                              {key === "image_coverage"
                                ? `${(value * 100).toFixed(0)}%`
                                : value.toFixed(3)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )
          })()}
      </div>
    </div>
  )
}
