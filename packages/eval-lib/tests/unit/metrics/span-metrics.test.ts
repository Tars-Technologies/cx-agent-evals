import { describe, expect, it } from "vitest"
import { iou } from "../../../src/evaluation/metrics/iou.js"
import { precision } from "../../../src/evaluation/metrics/precision.js"
import { recall } from "../../../src/evaluation/metrics/recall.js"
import { mergeOverlappingSpans } from "../../../src/evaluation/metrics/utils.js"
import type { CharacterSpan } from "../../../src/types/chunks.js"
import { DocumentId } from "../../../src/types/primitives.js"

const span = (docId: string, start: number, end: number): CharacterSpan => ({
  docId: DocumentId(docId),
  start,
  end,
  text: "x".repeat(end - start)
})

describe("mergeOverlappingSpans", () => {
  it("should merge overlapping spans in same document", () => {
    const merged = mergeOverlappingSpans([
      span("doc1", 0, 50),
      span("doc1", 30, 80)
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(80)
  })

  it("should merge adjacent spans", () => {
    const merged = mergeOverlappingSpans([
      span("doc1", 0, 50),
      span("doc1", 50, 100)
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(100)
  })

  it("should not merge non-overlapping spans", () => {
    const merged = mergeOverlappingSpans([
      span("doc1", 0, 50),
      span("doc1", 100, 150)
    ])
    expect(merged).toHaveLength(2)
  })

  it("should not merge spans across documents", () => {
    const merged = mergeOverlappingSpans([
      span("doc1", 0, 50),
      span("doc2", 0, 50)
    ])
    expect(merged).toHaveLength(2)
  })

  it("should return empty for empty input", () => {
    expect(mergeOverlappingSpans([])).toEqual([])
  })

  it("should handle multiple overlapping spans", () => {
    const merged = mergeOverlappingSpans([
      span("doc1", 0, 30),
      span("doc1", 20, 60),
      span("doc1", 50, 90)
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].start).toBe(0)
    expect(merged[0].end).toBe(90)
  })
})

describe("recall", () => {
  it("should return 1.0 for perfect recall", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 0, 100)]
    expect(recall.calculate(retrieved, gt)).toBe(1.0)
  })

  it("should return 0.5 for partial recall", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 0, 50)]
    expect(recall.calculate(retrieved, gt)).toBe(0.5)
  })

  it("should return 0.0 for no overlap", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 200, 300)]
    expect(recall.calculate(retrieved, gt)).toBe(0.0)
  })

  it("should return 1.0 for empty ground truth", () => {
    expect(recall.calculate([span("doc1", 0, 50)], [])).toBe(1.0)
  })

  it("should return 1.0 for both empty", () => {
    expect(recall.calculate([], [])).toBe(1.0)
  })

  it("should handle cross-document (no overlap)", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc2", 0, 100)]
    expect(recall.calculate(retrieved, gt)).toBe(0.0)
  })
})

describe("precision", () => {
  it("should return 1.0 for perfect precision", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 0, 100)]
    expect(precision.calculate(retrieved, gt)).toBe(1.0)
  })

  it("should return 0.5 for over-retrieval", () => {
    const gt = [span("doc1", 0, 50)]
    const retrieved = [span("doc1", 0, 100)]
    expect(precision.calculate(retrieved, gt)).toBe(0.5)
  })

  it("should return 0.0 for empty retrieved", () => {
    expect(precision.calculate([], [span("doc1", 0, 100)])).toBe(0.0)
  })
})

describe("iou", () => {
  it("should return 1.0 for perfect overlap", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 0, 100)]
    expect(iou.calculate(retrieved, gt)).toBe(1.0)
  })

  it("should compute partial overlap IoU", () => {
    const gt = [span("doc1", 0, 100)]
    const retrieved = [span("doc1", 50, 150)]
    // Intersection: 50, Union: 150
    expect(iou.calculate(retrieved, gt)).toBeCloseTo(0.333, 2)
  })

  it("should return 1.0 for both empty", () => {
    expect(iou.calculate([], [])).toBe(1.0)
  })

  it("should return 0.0 for one empty", () => {
    expect(iou.calculate([], [span("doc1", 0, 100)])).toBe(0.0)
    expect(iou.calculate([span("doc1", 0, 100)], [])).toBe(0.0)
  })

  it("should return 0.0 for no overlap", () => {
    expect(iou.calculate([span("doc1", 0, 50)], [span("doc1", 100, 200)])).toBe(
      0.0
    )
  })
})
