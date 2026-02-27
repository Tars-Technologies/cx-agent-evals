import type { SpanRange } from "../types/chunks.js";

export function spanOverlaps(a: SpanRange, b: SpanRange): boolean {
  if (a.docId !== b.docId) return false;
  return a.start < b.end && b.start < a.end;
}

export function spanOverlapChars(a: SpanRange, b: SpanRange): number {
  if (!spanOverlaps(a, b)) return 0;
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

export function spanLength(span: SpanRange): number {
  return span.end - span.start;
}

export function mergeOverlappingSpans(spans: readonly SpanRange[]): SpanRange[] {
  if (spans.length === 0) return [];

  const byDoc = new Map<string, SpanRange[]>();
  for (const span of spans) {
    const key = String(span.docId);
    const existing = byDoc.get(key) ?? [];
    existing.push(span);
    byDoc.set(key, existing);
  }

  const merged: SpanRange[] = [];

  for (const [, docSpans] of byDoc) {
    const sorted = [...docSpans].sort((a, b) => a.start - b.start);
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= current.end) {
        current = {
          docId: current.docId,
          start: current.start,
          end: Math.max(current.end, sorted[i].end),
        };
      } else {
        merged.push(current);
        current = sorted[i];
      }
    }
    merged.push(current);
  }

  return merged;
}

export function calculateOverlap(
  spansA: readonly SpanRange[],
  spansB: readonly SpanRange[],
): number {
  const mergedA = mergeOverlappingSpans(spansA);
  const mergedB = mergeOverlappingSpans(spansB);

  let total = 0;
  for (const a of mergedA) {
    for (const b of mergedB) {
      total += spanOverlapChars(a, b);
    }
  }
  return total;
}

export function totalSpanLength(spans: readonly SpanRange[]): number {
  return mergeOverlappingSpans(spans).reduce((sum, s) => sum + spanLength(s), 0);
}
