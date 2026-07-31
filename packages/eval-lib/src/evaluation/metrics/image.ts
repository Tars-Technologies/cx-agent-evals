/**
 * Set-based image retrieval metrics.
 *
 * Measures whether the embedding ranking pipeline surfaced the right images
 * into the menu that was offered to the agent. Ground truth is a list of
 * relevant imageIds (labeled offline by a vision LLM); `offered` is the
 * best-first-ranked, de-duplicated, cap-sized menu offered to the agent
 * across the whole turn (see capOfferedImages) — NOT a raw union of every
 * retrieval call's menu, which would grow unbounded with how many times the
 * agent searched.
 *
 * Questions with no relevant images (empty groundTruth) are excluded from
 * experiment-level averages by the caller — this function returns 1/1/1 for
 * them so a caller that does include them isn't penalised.
 */

export interface ImageSetMetrics {
  image_recall: number
  image_precision: number
  image_f1: number
}

/**
 * Compute recall, precision, and F1 for image menu coverage.
 *
 * `image_recall` is a plain set check: of the relevant images, how many
 * appeared anywhere in the offered menu.
 *
 * `image_precision` is Precision@K, where K = groundTruth.length: only the
 * top-K best-ranked offered images are checked, not the whole menu. A fixed
 * menu cap (e.g. 6) otherwise structurally bounds precision whenever
 * groundTruth is small — a perfect ranking with 1 relevant image among 6
 * offered would floor at 1/6 precision under plain set precision, even
 * though the ranking did nothing wrong. Precision@K asks the fairer
 * question: "of your best K guesses, how many were right?"
 *
 * @param offered  Best-first-ranked, deduplicated, capped menu offered this
 *                 turn (see capOfferedImages) — order matters for precision.
 * @param groundTruth  Relevant imageIds labeled during question generation
 */
export function computeImageSetMetrics(
  offered: string[],
  groundTruth: string[]
): ImageSetMetrics {
  if (groundTruth.length === 0) {
    return { image_recall: 1, image_precision: 1, image_f1: 1 }
  }
  if (offered.length === 0) {
    return { image_recall: 0, image_precision: 0, image_f1: 0 }
  }

  const groundTruthSet = new Set(groundTruth)
  const offeredSet = new Set(offered)

  const recallHits = groundTruth.filter((id) => offeredSet.has(id)).length
  const recall = recallHits / groundTruth.length

  const k = Math.min(groundTruth.length, offered.length)
  const topK = offered.slice(0, k)
  const precisionHits = topK.filter((id) => groundTruthSet.has(id)).length
  const precision = k > 0 ? precisionHits / k : 0

  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall)

  return { image_recall: recall, image_precision: precision, image_f1: f1 }
}
