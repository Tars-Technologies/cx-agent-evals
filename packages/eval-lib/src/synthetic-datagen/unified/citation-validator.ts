import { distance } from "fastest-levenshtein"
import { normalizedFind } from "../../utils/span.js"

export interface CitationSpan {
  readonly start: number
  readonly end: number
  readonly text: string
}

// Skip fuzzy tier beyond this; Levenshtein is O(L*window) per step.
const MAX_FUZZY_EXCERPT_LEN = 2000
// Fixed refinement radius; excerpt-scaled made it ~O(L^4).
const REFINE_RADIUS = 12

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
  const norm = normalizedFind(docContent, excerpt)
  if (norm !== null && norm.end > norm.start) {
    return {
      start: norm.start,
      end: norm.end,
      text: docContent.substring(norm.start, norm.end)
    }
  }

  // Tier 3: Fuzzy sliding window
  const fuzzyResult = fuzzySubstringMatch(docContent, excerpt)
  if (fuzzyResult !== null && fuzzyResult.end > fuzzyResult.start) {
    return fuzzyResult
  }

  return null
}

function fuzzySubstringMatch(
  docContent: string,
  excerpt: string,
  threshold = 0.7
): CitationSpan | null {
  const excerptLen = excerpt.length
  if (excerptLen > MAX_FUZZY_EXCERPT_LEN) return null
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

  // Tighten the coarse boundary at stride 1 within a fixed neighborhood.
  if (bestStart !== -1) {
    const startLo = Math.max(0, bestStart - REFINE_RADIUS)
    const startHi = Math.min(docContent.length, bestStart + REFINE_RADIUS)
    for (let s = startLo; s <= startHi; s++) {
      const endLo = Math.max(s + 1, bestEnd - REFINE_RADIUS)
      const endHi = Math.min(docContent.length, bestEnd + REFINE_RADIUS)
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
