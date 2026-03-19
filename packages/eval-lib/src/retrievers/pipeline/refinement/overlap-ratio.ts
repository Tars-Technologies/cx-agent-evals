import type { PositionAwareChunk } from "../../../types/chunks.js";
import { spanOverlapChars } from "../../../utils/span.js";

/**
 * Compute character span overlap ratio between two chunks.
 * Returns 0 for cross-document chunks. Returns overlap / min(len(a), len(b)).
 */
export function contentOverlapRatio(
  a: PositionAwareChunk,
  b: PositionAwareChunk,
): number {
  if (a.docId !== b.docId) return 0;

  const overlapChars = spanOverlapChars(
    { docId: a.docId, start: a.start, end: a.end },
    { docId: b.docId, start: b.start, end: b.end },
  );

  const minLength = Math.min(a.end - a.start, b.end - b.start);
  if (minLength === 0) return 0;

  return overlapChars / minLength;
}
