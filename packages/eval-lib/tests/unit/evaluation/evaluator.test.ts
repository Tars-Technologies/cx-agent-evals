import { describe, expect, it } from "vitest"
import { computeMetrics } from "../../../src/evaluation/evaluator.js"
import {
  iou,
  precision,
  recall
} from "../../../src/evaluation/metrics/index.js"
import type { CharacterSpan } from "../../../src/types/chunks.js"
import { DocumentId } from "../../../src/types/primitives.js"

describe("computeMetrics", () => {
  const metrics = [recall, precision, iou]
  const docId = DocumentId("doc1")

  function createSpan(start: number, end: number, text: string): CharacterSpan {
    return { docId, start, end, text }
  }

  it("should return averaged scores for multiple results", () => {
    const results = [
      {
        retrieved: [createSpan(0, 100, "x".repeat(100))],
        groundTruth: [createSpan(0, 100, "x".repeat(100))]
      },
      {
        retrieved: [createSpan(0, 50, "x".repeat(50))],
        groundTruth: [createSpan(0, 100, "x".repeat(100))]
      }
    ]

    const scores = computeMetrics({ results, metrics })

    // First result: recall=1, precision=1, iou=1
    // Second result: recall=0.5, precision=1, iou=0.5
    // Averages: recall=0.75, precision=1, iou=0.75
    expect(scores.recall).toBeCloseTo(0.75)
    expect(scores.precision).toBeCloseTo(1.0)
    expect(scores.iou).toBeCloseTo(0.75)
  })

  it("should return zeros for empty results", () => {
    const scores = computeMetrics({ results: [], metrics })

    expect(scores.recall).toBe(0)
    expect(scores.precision).toBe(0)
    expect(scores.iou).toBe(0)
  })

  it("should handle partial overlap", () => {
    const results = [
      {
        retrieved: [createSpan(50, 150, "x".repeat(100))],
        groundTruth: [createSpan(0, 100, "x".repeat(100))]
      }
    ]

    const scores = computeMetrics({ results, metrics })

    // overlap = 50 chars (50-100)
    // recall = 50/100 = 0.5
    // precision = 50/100 = 0.5
    // iou = 50/150 = 0.333
    expect(scores.recall).toBeCloseTo(0.5)
    expect(scores.precision).toBeCloseTo(0.5)
    expect(scores.iou).toBeCloseTo(0.333, 2)
  })
})
