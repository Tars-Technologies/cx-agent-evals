import { f1, iou, precision, recall } from "../evaluation/index.js"
import type { Metric } from "../evaluation/metrics/base.js"
import type { Retriever } from "../retrievers/retriever.interface.js"
import type { ExperimentResult } from "../shared/types.js"
import type { CharacterSpan, Corpus } from "../types/index.js"
import { positionAwareChunkToSpan } from "../types/index.js"

export const DEFAULT_METRICS: readonly Metric[] = [recall, precision, iou, f1]

export interface RetrieverEvaluationExample {
  readonly query: string
  readonly groundTruth: CharacterSpan[]
}

export interface RunRetrieverEvaluationConfig {
  readonly corpus: Corpus
  readonly retriever: Retriever
  readonly k: number
  readonly dataset: readonly RetrieverEvaluationExample[]
  readonly metrics?: readonly Metric[]
  readonly onResult?: (result: ExperimentResult) => Promise<void>
  /** Max queries retrieved concurrently within this action (default: 1). */
  readonly maxConcurrency?: number
}

export async function runRetrieverEvaluation(
  config: RunRetrieverEvaluationConfig
): Promise<void> {
  const { corpus, retriever, k, dataset, onResult } = config
  const metrics = config.metrics ?? DEFAULT_METRICS
  const concurrency = Math.max(1, config.maxConcurrency ?? 1)

  await retriever.init(corpus)
  let next = 0
  let aborted = false
  const worker = async () => {
    while (!aborted && next < dataset.length) {
      const ex = dataset[next++]
      try {
        const chunks = await retriever.retrieve(ex.query, k)
        const retrieved: CharacterSpan[] = []
        for (const chunk of chunks) {
          try {
            retrieved.push(positionAwareChunkToSpan(chunk))
          } catch (err) {
            console.warn(
              `runRetrieverEvaluation: skipping chunk ${String(chunk.id)} with invalid span — ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          }
        }
        const scores: Record<string, number> = {}
        for (const metric of metrics) {
          scores[metric.name] = metric.calculate(retrieved, ex.groundTruth)
        }
        await onResult?.({
          query: ex.query,
          retrievedSpans: retrieved.map((s) => ({
            docId: String(s.docId),
            start: s.start,
            end: s.end,
            text: s.text
          })),
          scores
        })
      } catch (err) {
        aborted = true
        throw err
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, dataset.length) },
    worker
  )
  try {
    await Promise.all(workers)
  } finally {
    await Promise.allSettled(workers)
    await retriever.cleanup()
  }
}
