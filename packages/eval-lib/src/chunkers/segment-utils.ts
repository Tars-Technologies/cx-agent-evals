export interface TextSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Split text into segments of approximately segmentSize characters,
 * preferring to break at word boundaries (spaces).
 *
 * Guarantees: no gaps between segments, full text coverage,
 * positions satisfy text.slice(seg.start, seg.end) === seg.text.
 */
export function splitIntoSegments(
  text: string,
  segmentSize: number,
): TextSegment[] {
  if (text.length === 0) return [];

  const segments: TextSegment[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + segmentSize, text.length);

    // Try to break at a word boundary (last space before end)
    if (end < text.length) {
      const spaceIdx = text.lastIndexOf(" ", end);
      if (spaceIdx > pos) {
        end = spaceIdx + 1; // include the space in the current segment
      }
    }

    segments.push({
      text: text.slice(pos, end),
      start: pos,
      end,
    });
    pos = end;
  }

  return segments;
}

/**
 * Split text into sentences using punctuation + capital-letter boundaries.
 *
 * Splits after sentence-ending punctuation (`.`, `!`, `?`) followed by
 * whitespace and an uppercase letter. Each returned segment carries its
 * character-level position in the original text.
 */
export function splitSentences(text: string): TextSegment[] {
  if (text.trim().length === 0) return [];

  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const result: TextSegment[] = [];
  let searchFrom = 0;

  for (const part of parts) {
    if (part.trim().length === 0) continue;
    const idx = text.indexOf(part, searchFrom);
    if (idx === -1) continue;
    result.push({ text: part, start: idx, end: idx + part.length });
    searchFrom = idx + part.length;
  }

  return result;
}
