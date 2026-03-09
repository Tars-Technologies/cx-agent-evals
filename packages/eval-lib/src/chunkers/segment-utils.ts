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
