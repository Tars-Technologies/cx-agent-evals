import type { Corpus } from "../../../types/documents.js"
import { generatePaChunkId } from "../../../utils/hashing.js"
import type { ScoredChunk } from "../types.js"

/**
 * Expand each chunk by including surrounding characters from the source document.
 *
 * For each chunk, extends the character span by windowChars in both directions
 * (clamped to document boundaries). The chunk ID is regenerated because content
 * and position have changed.
 *
 * After expansion, spans from the same document that overlap (or touch) are
 * merged into a single span, so adjacent chunks expanding into the same region
 * do not emit duplicate/overlapping output (which would inflate recall). A
 * merged span keeps the highest score among its members and regenerates its
 * content and ID from the merged bounds.
 *
 * Chunks whose source document is not found in the corpus are returned unchanged
 * and never merged.
 */
export function applyExpandContext(
  results: readonly ScoredChunk[],
  corpus: Corpus,
  windowChars: number
): ScoredChunk[] {
  // Build a lookup map for O(1) doc access
  const docMap = new Map(corpus.documents.map((doc) => [String(doc.id), doc]))

  // Chunks whose document is not in the corpus cannot be expanded or merged.
  const passthrough: ScoredChunk[] = []
  // Expanded chunks grouped by document so within-doc overlaps can be merged.
  const byDoc = new Map<string, ScoredChunk[]>()

  for (const { chunk, score } of results) {
    const docKey = String(chunk.docId)
    const doc = docMap.get(docKey)
    if (!doc) {
      passthrough.push({ chunk, score })
      continue
    }

    const newStart = Math.max(0, chunk.start - windowChars)
    const newEnd = Math.min(doc.content.length, chunk.end + windowChars)
    const newContent = doc.content.slice(newStart, newEnd)

    const list = byDoc.get(docKey) ?? []
    list.push({
      chunk: {
        ...chunk,
        content: newContent,
        start: newStart,
        end: newEnd,
        id: generatePaChunkId(newContent, docKey, newStart)
      },
      score
    })
    byDoc.set(docKey, list)
  }

  const output: ScoredChunk[] = [...passthrough]
  for (const [docKey, list] of byDoc) {
    output.push(...mergeDocGroup(list, docMap.get(docKey)!))
  }

  // The pipeline slices the final top-k without re-sorting, so expand-context
  // must leave its output in descending score order. It only adds context to
  // already-ranked results; it must not change their ranking.
  return output.sort((a, b) => b.score - a.score)
}

/** Merge overlapping/touching spans within a single document group. */
function mergeDocGroup(
  items: readonly ScoredChunk[],
  doc: Corpus["documents"][number]
): ScoredChunk[] {
  // Sort by start so overlapping spans are adjacent; merge the sorted runs.
  const sorted = [...items].sort((a, b) => a.chunk.start - b.chunk.start)

  const merged: ScoredChunk[] = []
  let start = sorted[0].chunk.start
  let end = sorted[0].chunk.end
  let best = sorted[0]

  const flush = (): void => {
    const content = doc.content.slice(start, end)
    merged.push({
      chunk: {
        ...best.chunk,
        content,
        start,
        end,
        id: generatePaChunkId(content, String(best.chunk.docId), start)
      },
      score: best.score
    })
  }

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    if (item.chunk.start <= end) {
      // Overlaps or touches the running span: extend and keep the best score.
      end = Math.max(end, item.chunk.end)
      if (item.score > best.score) best = item
    } else {
      flush()
      start = item.chunk.start
      end = item.chunk.end
      best = item
    }
  }
  flush()

  return merged
}
