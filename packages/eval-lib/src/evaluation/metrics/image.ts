/**
 * Set-based image retrieval metrics.
 *
 * Measures whether the embedding ranking pipeline surfaced the right images
 * into the menu that was offered to the agent. Ground truth is a list of
 * relevant imageIds (labeled offline by a vision LLM); the "retrieved" set is
 * the union of all imageIds offered across every tool call for a question.
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
 * @param offered  Union of all imageIds offered across all retrieval tool calls
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

  const offeredSet = new Set(offered)
  const hits = groundTruth.filter((id) => offeredSet.has(id)).length

  const recall = hits / groundTruth.length
  const precision = hits / offered.length
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall)

  return { image_recall: recall, image_precision: precision, image_f1: f1 }
}
