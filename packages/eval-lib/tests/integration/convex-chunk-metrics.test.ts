/**
 * Integration test: Verify that Convex chunk data (as returned by fetchChunksWithDocs)
 * is directly usable with eval-lib metric functions after the mapping done in
 * experimentActions.ts.
 *
 * This validates the data contract between the Convex backend and eval-lib metrics.
 */
import { describe, expect, it } from "vitest"
import {
  type CharacterSpan,
  createCharacterSpan,
  f1,
  iou,
  type Metric,
  precision,
  recall
} from "../../src/index.js"

/**
 * Simulates the shape returned by convex/rag.ts fetchChunksWithDocs.
 * In the real code, this comes from ctx.db.get(chunkId) + doc lookup.
 */
interface ConvexChunkRecord {
  _id: string
  documentId: string
  kbId: string
  chunkId: string
  content: string
  start: number
  end: number
  embedding: number[]
  metadata: Record<string, unknown>
  docId: string // Joined from the parent document
}

/**
 * Mirrors the mapping in experimentActions.ts runEvaluation:
 *   const retrievedSpans = chunks.map((c) => ({
 *     docId: c.docId,
 *     start: c.start,
 *     end: c.end,
 *     text: c.content,
 *   }));
 */
function convexChunksToSpans(chunks: ConvexChunkRecord[]): CharacterSpan[] {
  return chunks.map((c) =>
    createCharacterSpan({
      docId: c.docId,
      start: c.start,
      end: c.end,
      text: c.content
    })
  )
}

// Helper: create a mock Convex chunk record
function mockChunk(
  docId: string,
  start: number,
  end: number,
  content?: string
): ConvexChunkRecord {
  return {
    _id: `chunk_${docId}_${start}`,
    documentId: `doc_${docId}`,
    kbId: "kb_1",
    chunkId: `pa_${docId}_${start}_${end}`,
    content: content ?? "x".repeat(end - start),
    start,
    end,
    embedding: [0.1, 0.2, 0.3],
    metadata: {},
    docId
  }
}

// Helper: create ground truth span
function gtSpan(docId: string, start: number, end: number): CharacterSpan {
  return createCharacterSpan({
    docId,
    start,
    end,
    text: "x".repeat(end - start)
  })
}

const ALL_METRICS: Metric[] = [recall, precision, iou, f1]

describe("Convex chunks → eval-lib metrics integration", () => {
  it("should convert Convex chunk records to valid CharacterSpans", () => {
    const chunks = [
      mockChunk("doc1", 0, 100),
      mockChunk("doc1", 200, 350),
      mockChunk("doc2", 50, 200)
    ]

    const spans = convexChunksToSpans(chunks)

    expect(spans).toHaveLength(3)
    expect(spans[0]).toEqual(
      expect.objectContaining({ docId: "doc1", start: 0, end: 100 })
    )
    expect(spans[1]).toEqual(
      expect.objectContaining({ docId: "doc1", start: 200, end: 350 })
    )
    expect(spans[2]).toEqual(
      expect.objectContaining({ docId: "doc2", start: 50, end: 200 })
    )
  })

  it("should compute perfect scores when retrieved chunks exactly match ground truth", () => {
    const chunks = [mockChunk("doc1", 0, 100), mockChunk("doc2", 50, 200)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc1", 0, 100), gtSpan("doc2", 50, 200)]

    for (const metric of ALL_METRICS) {
      expect(metric.calculate(retrieved, groundTruth)).toBe(1.0)
    }
  })

  it("should compute correct partial overlap scores", () => {
    // Retrieved chunk covers doc1[0,100], ground truth is doc1[50,150]
    // Overlap: 50 chars (50-100), GT total: 100, Ret total: 100
    const chunks = [mockChunk("doc1", 0, 100)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc1", 50, 150)]

    expect(recall.calculate(retrieved, groundTruth)).toBe(0.5)
    expect(precision.calculate(retrieved, groundTruth)).toBe(0.5)
    expect(iou.calculate(retrieved, groundTruth)).toBeCloseTo(1 / 3, 2)
    expect(f1.calculate(retrieved, groundTruth)).toBe(0.5)
  })

  it("should handle multiple retrieved chunks against single ground truth", () => {
    // GT: doc1[0, 200] (200 chars)
    // Retrieved: doc1[0,100] and doc1[150,250]
    // Overlap with GT: 100 (0-100) + 50 (150-200) = 150
    // Retrieved total: 100 + 100 = 200
    const chunks = [mockChunk("doc1", 0, 100), mockChunk("doc1", 150, 250)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc1", 0, 200)]

    expect(recall.calculate(retrieved, groundTruth)).toBe(150 / 200)
    expect(precision.calculate(retrieved, groundTruth)).toBe(150 / 200)
  })

  it("should return zero scores for cross-document mismatch", () => {
    // Retrieved from doc1, ground truth in doc2 — no overlap
    const chunks = [mockChunk("doc1", 0, 100)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc2", 0, 100)]

    expect(recall.calculate(retrieved, groundTruth)).toBe(0.0)
    expect(precision.calculate(retrieved, groundTruth)).toBe(0.0)
    expect(iou.calculate(retrieved, groundTruth)).toBe(0.0)
    expect(f1.calculate(retrieved, groundTruth)).toBe(0.0)
  })

  it("should handle multi-document retrieval with multi-document ground truth", () => {
    // Retrieved: doc1[0,100], doc2[0,100]
    // GT: doc1[0,100], doc2[0,50]
    // doc1 overlap: 100/100, doc2 overlap: 50/100
    const chunks = [mockChunk("doc1", 0, 100), mockChunk("doc2", 0, 100)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc1", 0, 100), gtSpan("doc2", 0, 50)]

    // Recall: (100 + 50) / (100 + 50) = 1.0 (all GT is covered)
    expect(recall.calculate(retrieved, groundTruth)).toBe(1.0)
    // Precision: (100 + 50) / (100 + 100) = 0.75
    expect(precision.calculate(retrieved, groundTruth)).toBe(0.75)
  })

  it("should handle overlapping retrieved chunks (merged before metric calc)", () => {
    // Two overlapping chunks from same doc: [0,60] and [40,100]
    // After merging: [0,100] — 100 chars
    // GT: [0,100]
    const chunks = [mockChunk("doc1", 0, 60), mockChunk("doc1", 40, 100)]
    const retrieved = convexChunksToSpans(chunks)
    const groundTruth = [gtSpan("doc1", 0, 100)]

    expect(recall.calculate(retrieved, groundTruth)).toBe(1.0)
    expect(precision.calculate(retrieved, groundTruth)).toBe(1.0)
    expect(iou.calculate(retrieved, groundTruth)).toBe(1.0)
  })

  it("should work with real-ish content text (not just placeholders)", () => {
    const content = "The quick brown fox jumps over the lazy dog."
    const chunk = mockChunk("doc1", 10, 10 + content.length, content)
    const retrieved = convexChunksToSpans([chunk])

    // GT covers part of the same range
    const gtContent = "brown fox jumps over"
    const gtStart = 10 + content.indexOf("brown")
    const gt = [
      createCharacterSpan({
        docId: "doc1",
        start: gtStart,
        end: gtStart + gtContent.length,
        text: gtContent
      })
    ]

    // Should compute without errors and return valid numbers
    for (const metric of ALL_METRICS) {
      const score = metric.calculate(retrieved, gt)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }

    // GT is fully within retrieved, so recall should be 1.0
    expect(recall.calculate(retrieved, gt)).toBe(1.0)
    // Precision < 1.0 since retrieved is larger than GT
    expect(precision.calculate(retrieved, gt)).toBeLessThan(1.0)
  })

  it("should handle empty retrieved spans (no chunks found)", () => {
    const groundTruth = [gtSpan("doc1", 0, 100)]

    expect(recall.calculate([], groundTruth)).toBe(0.0)
    expect(precision.calculate([], groundTruth)).toBe(0.0)
    expect(iou.calculate([], groundTruth)).toBe(0.0)
    expect(f1.calculate([], groundTruth)).toBe(0.0)
  })
})
