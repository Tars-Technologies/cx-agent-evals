import { z } from "zod"
import type { DocumentId, PositionAwareChunkId } from "./primitives.js"
import { DocumentId as DocumentIdFactory } from "./primitives.js"

export const CharacterSpanSchema = z
  .object({
    docId: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string()
  })
  .refine((data) => data.end > data.start, {
    message: "end must be greater than start"
  })
  .refine((data) => data.text.length === data.end - data.start, {
    message: "text length must match span length (end - start)"
  })

export interface CharacterSpan {
  readonly docId: DocumentId
  readonly start: number
  readonly end: number
  readonly text: string
}

/** Internal type for metric calculations where text content is irrelevant. */
export interface SpanRange {
  readonly docId: DocumentId
  readonly start: number
  readonly end: number
}

export interface PositionAwareChunk {
  readonly id: PositionAwareChunkId
  readonly content: string
  readonly docId: DocumentId
  readonly start: number
  readonly end: number
  readonly metadata: Readonly<Record<string, unknown>>
}

export function createCharacterSpan(params: {
  docId: string
  start: number
  end: number
  text: string
}): CharacterSpan {
  CharacterSpanSchema.parse(params)
  return {
    docId: DocumentIdFactory(params.docId),
    start: params.start,
    end: params.end,
    text: params.text
  }
}

export function positionAwareChunkToSpan(
  chunk: PositionAwareChunk
): CharacterSpan {
  return {
    docId: chunk.docId,
    start: chunk.start,
    end: chunk.end,
    text: chunk.content
  }
}
