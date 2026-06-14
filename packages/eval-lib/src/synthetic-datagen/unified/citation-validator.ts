import { distance } from "fastest-levenshtein"

export interface CitationSpan {
  readonly start: number
  readonly end: number
  readonly text: string
}

export function findCitationSpan(
  docContent: string,
  excerpt: string
): CitationSpan | null {
  // An empty / whitespace-only excerpt is not a real citation. Without this
  // guard Tier-1 `indexOf("")` returns 0 and yields a phantom zero-length span
  // {0,0,""}; it then evades the `relevantSpans.length > 0` sync/experiment
  // filter and inflates recall to 1.0 for every retriever (GEN-1).
  if (excerpt.trim().length === 0) return null

  // Tier 1: Exact match
  const exactIdx = docContent.indexOf(excerpt)
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + excerpt.length, text: excerpt }
  }

  // Tier 2: Whitespace + case normalized match
  const normResult = normalizedFind(docContent, excerpt)
  if (normResult !== null && normResult.end > normResult.start) {
    return normResult
  }

  // Tier 3: Fuzzy sliding window
  const fuzzyResult = fuzzySubstringMatch(docContent, excerpt)
  if (fuzzyResult !== null && fuzzyResult.end > fuzzyResult.start) {
    return fuzzyResult
  }

  return null
}

function normalizedFind(
  docContent: string,
  excerpt: string
): CitationSpan | null {
  const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim()
  const normDoc = normalize(docContent)
  const normExcerpt = normalize(excerpt)
  const idx = normDoc.indexOf(normExcerpt)
  if (idx === -1) return null

  // Map normalized index back to original
  const origStart = mapNormToOrig(docContent, idx)
  const origEnd = mapNormToOrig(docContent, idx + normExcerpt.length)
  const text = docContent.substring(origStart, origEnd)
  return { start: origStart, end: origEnd, text }
}

function mapNormToOrig(original: string, normIdx: number): number {
  let origPos = 0
  let normPos = 0
  // Skip leading whitespace
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

function fuzzySubstringMatch(
  docContent: string,
  excerpt: string,
  threshold = 0.7
): CitationSpan | null {
  const excerptLen = excerpt.length
  const windowSize = Math.ceil(excerptLen * 1.3)
  const minWindowSize = Math.floor(excerptLen * 0.7)
  const normExcerpt = excerpt.toLowerCase().replace(/\s+/g, " ").trim()

  let bestScore = 0
  let bestStart = -1
  let bestEnd = -1

  // Slide window over document
  for (
    let size = minWindowSize;
    size <= windowSize;
    size += Math.max(1, Math.floor(excerptLen * 0.1))
  ) {
    for (
      let i = 0;
      i <= docContent.length - size;
      i += Math.max(1, Math.floor(size * 0.2))
    ) {
      const window = docContent.substring(i, i + size)
      const normWindow = window.toLowerCase().replace(/\s+/g, " ").trim()
      const maxLen = Math.max(normExcerpt.length, normWindow.length)
      if (maxLen === 0) continue
      const dist = distance(normExcerpt, normWindow)
      const similarity = 1 - dist / maxLen

      if (similarity > bestScore) {
        bestScore = similarity
        bestStart = i
        bestEnd = i + size
      }
    }
  }

  // The coarse sweep steps `i` by ~20% of the window size, so the true optimum
  // can fall in every gap and the best sampled window is bounded to the nearest
  // step (off by a few characters at each edge). Refine start and end at stride 1
  // in the neighborhood of the best sample to tighten the returned boundary.
  if (bestStart !== -1) {
    const coarseStride = Math.max(1, Math.floor((bestEnd - bestStart) * 0.2))
    const sizeStep = Math.max(1, Math.floor(excerptLen * 0.1))
    const startLo = Math.max(0, bestStart - coarseStride)
    const startHi = Math.min(docContent.length, bestStart + coarseStride)
    for (let s = startLo; s <= startHi; s++) {
      const endLo = Math.max(s + 1, bestEnd - sizeStep)
      const endHi = Math.min(docContent.length, bestEnd + sizeStep)
      for (let e = endLo; e <= endHi; e++) {
        const normWindow = docContent
          .substring(s, e)
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
        const maxLen = Math.max(normExcerpt.length, normWindow.length)
        if (maxLen === 0) continue
        const similarity = 1 - distance(normExcerpt, normWindow) / maxLen
        if (similarity > bestScore) {
          bestScore = similarity
          bestStart = s
          bestEnd = e
        }
      }
    }
  }

  if (bestScore >= threshold && bestStart !== -1) {
    return {
      start: bestStart,
      end: bestEnd,
      text: docContent.substring(bestStart, bestEnd)
    }
  }

  return null
}
