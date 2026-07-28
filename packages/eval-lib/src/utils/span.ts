import type { SpanRange } from "../types/chunks.js"

export function spanOverlaps(a: SpanRange, b: SpanRange): boolean {
  if (a.docId !== b.docId) return false
  return a.start < b.end && b.start < a.end
}

export function spanOverlapChars(a: SpanRange, b: SpanRange): number {
  if (!spanOverlaps(a, b)) return 0
  return Math.min(a.end, b.end) - Math.max(a.start, b.start)
}

export function spanLength(span: SpanRange): number {
  return span.end - span.start
}

export function mergeOverlappingSpans(
  spans: readonly SpanRange[]
): SpanRange[] {
  if (spans.length === 0) return []

  const byDoc = new Map<string, SpanRange[]>()
  for (const span of spans) {
    const key = String(span.docId)
    const existing = byDoc.get(key) ?? []
    existing.push(span)
    byDoc.set(key, existing)
  }

  const merged: SpanRange[] = []

  for (const [, docSpans] of byDoc) {
    const sorted = [...docSpans].sort((a, b) => a.start - b.start)
    let current = sorted[0]

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= current.end) {
        current = {
          docId: current.docId,
          start: current.start,
          end: Math.max(current.end, sorted[i].end)
        }
      } else {
        merged.push(current)
        current = sorted[i]
      }
    }
    merged.push(current)
  }

  return merged
}

export function calculateOverlap(
  spansA: readonly SpanRange[],
  spansB: readonly SpanRange[]
): number {
  const mergedA = mergeOverlappingSpans(spansA)
  const mergedB = mergeOverlappingSpans(spansB)

  return calculateOverlapPreMerged(mergedA, mergedB)
}

/**
 * Calculate overlap between two sets of spans that have already been merged.
 * Use this when you have pre-computed merged spans to avoid redundant merging.
 */
export function calculateOverlapPreMerged(
  mergedA: readonly SpanRange[],
  mergedB: readonly SpanRange[]
): number {
  let total = 0
  for (const a of mergedA) {
    for (const b of mergedB) {
      total += spanOverlapChars(a, b)
    }
  }
  return total
}

export function totalSpanLength(spans: readonly SpanRange[]): number {
  return mergeOverlappingSpans(spans).reduce((sum, s) => sum + spanLength(s), 0)
}

/**
 * Calculate total span length from spans that have already been merged.
 * Use this when you have pre-computed merged spans to avoid redundant merging.
 */
export function totalSpanLengthPreMerged(
  mergedSpans: readonly SpanRange[]
): number {
  return mergedSpans.reduce((sum, s) => sum + spanLength(s), 0)
}

// Map an index in the whitespace-collapsed, trimmed, lowercased form of
// `original` back to an offset in `original`.
export function mapNormToOrig(original: string, normIdx: number): number {
  let origPos = 0
  let normPos = 0
  while (origPos < original.length && /\s/.test(original[origPos])) origPos++
  while (normPos < normIdx && origPos < original.length) {
    if (/\s/.test(original[origPos])) {
      while (origPos < original.length - 1 && /\s/.test(original[origPos + 1]))
        origPos++
    }
    origPos++
    normPos++
  }
  return origPos
}

// Find `excerpt` in `text` ignoring case and whitespace differences, mapping
// both ends back to original offsets so the span covers the real region.
export function normalizedFind(
  text: string,
  excerpt: string
): { start: number; end: number } | null {
  const normalize = (s: string) =>
    s
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”‟]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim()
  const normText = normalize(text)
  const normExcerpt = normalize(excerpt)
  const idx = normText.indexOf(normExcerpt)
  if (idx === -1) return null
  return {
    start: mapNormToOrig(text, idx),
    end: mapNormToOrig(text, idx + normExcerpt.length)
  }
}
