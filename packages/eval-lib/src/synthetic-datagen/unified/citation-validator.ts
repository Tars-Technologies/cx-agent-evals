import { distance } from "fastest-levenshtein";

export interface CitationSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function findCitationSpan(
  docContent: string,
  excerpt: string,
): CitationSpan | null {
  // Tier 1: Exact match
  const exactIdx = docContent.indexOf(excerpt);
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + excerpt.length, text: excerpt };
  }

  // Tier 2: Whitespace + case normalized match
  const normResult = normalizedFind(docContent, excerpt);
  if (normResult !== null) {
    return normResult;
  }

  // Tier 3: Fuzzy sliding window
  return fuzzySubstringMatch(docContent, excerpt);
}

function normalizedFind(docContent: string, excerpt: string): CitationSpan | null {
  const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
  const normDoc = normalize(docContent);
  const normExcerpt = normalize(excerpt);
  const idx = normDoc.indexOf(normExcerpt);
  if (idx === -1) return null;

  // Map normalized index back to original
  const origStart = mapNormToOrig(docContent, idx);
  const origEnd = mapNormToOrig(docContent, idx + normExcerpt.length);
  const text = docContent.substring(origStart, origEnd);
  return { start: origStart, end: origEnd, text };
}

function mapNormToOrig(original: string, normIdx: number): number {
  let origPos = 0;
  let normPos = 0;
  // Skip leading whitespace
  while (origPos < original.length && /\s/.test(original[origPos])) origPos++;

  while (normPos < normIdx && origPos < original.length) {
    if (/\s/.test(original[origPos])) {
      while (origPos < original.length - 1 && /\s/.test(original[origPos + 1])) origPos++;
    }
    origPos++;
    normPos++;
  }
  return origPos;
}

function fuzzySubstringMatch(
  docContent: string,
  excerpt: string,
  threshold = 0.7,
): CitationSpan | null {
  const excerptLen = excerpt.length;
  const windowSize = Math.ceil(excerptLen * 1.3);
  const minWindowSize = Math.floor(excerptLen * 0.7);
  const normExcerpt = excerpt.toLowerCase().replace(/\s+/g, " ").trim();

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  // Slide window over document
  for (let size = minWindowSize; size <= windowSize; size += Math.max(1, Math.floor(excerptLen * 0.1))) {
    for (let i = 0; i <= docContent.length - size; i += Math.max(1, Math.floor(size * 0.2))) {
      const window = docContent.substring(i, i + size);
      const normWindow = window.toLowerCase().replace(/\s+/g, " ").trim();
      const maxLen = Math.max(normExcerpt.length, normWindow.length);
      if (maxLen === 0) continue;
      const dist = distance(normExcerpt, normWindow);
      const similarity = 1 - dist / maxLen;

      if (similarity > bestScore) {
        bestScore = similarity;
        bestStart = i;
        bestEnd = i + size;
      }
    }
  }

  if (bestScore >= threshold && bestStart !== -1) {
    return {
      start: bestStart,
      end: bestEnd,
      text: docContent.substring(bestStart, bestEnd),
    };
  }

  return null;
}
