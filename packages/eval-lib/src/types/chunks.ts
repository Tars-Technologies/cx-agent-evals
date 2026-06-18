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
  // This is the seam where retriever output becomes scored spans, and it cannot
  // see the source document, so it cannot catch offset *drift* (a wrong but
  // self-consistent start/end). It can still reject the spans that silently
  // produce NaN/empty metrics downstream: non-finite, negative, or inverted
  // offsets. A retriever emitting one of those is a bug that should surface here
  // rather than poison the aggregate. (A mismatched text length is intentionally
  // allowed: contextual/summary strategies replace `content` for embedding.)
  if (
    !Number.isFinite(chunk.start) ||
    !Number.isFinite(chunk.end) ||
    chunk.start < 0 ||
    chunk.end <= chunk.start
  ) {
    throw new Error(
      `positionAwareChunkToSpan: invalid span offsets (start=${chunk.start}, end=${chunk.end}) for chunk ${String(chunk.id)}`
    )
  }
  return {
    docId: chunk.docId,
    start: chunk.start,
    end: chunk.end,
    text: chunk.content
  }
}
