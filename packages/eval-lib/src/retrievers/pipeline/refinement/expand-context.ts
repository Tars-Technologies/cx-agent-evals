import type { Corpus } from "../../../types/documents.js";
import type { ScoredChunk } from "../types.js";
import { generatePaChunkId } from "../../../utils/hashing.js";

/**
 * Expand each chunk by including surrounding characters from the source document.
 *
 * For each chunk, extends the character span by windowChars in both directions
 * (clamped to document boundaries). The chunk ID is regenerated because content
 * and position have changed.
 *
 * Chunks whose source document is not found in the corpus are returned unchanged.
 */
export function applyExpandContext(
  results: readonly ScoredChunk[],
  corpus: Corpus,
  windowChars: number,
): ScoredChunk[] {
  // Build a lookup map for O(1) doc access
  const docMap = new Map(
    corpus.documents.map((doc) => [String(doc.id), doc]),
  );

  return results.map(({ chunk, score }) => {
    const doc = docMap.get(String(chunk.docId));
    if (!doc) return { chunk, score };

    const newStart = Math.max(0, chunk.start - windowChars);
    const newEnd = Math.min(doc.content.length, chunk.end + windowChars);
    const newContent = doc.content.slice(newStart, newEnd);

    return {
      chunk: {
        ...chunk,
        content: newContent,
        start: newStart,
        end: newEnd,
        id: generatePaChunkId(newContent, String(chunk.docId), newStart),
      },
      score,
    };
  });
}
