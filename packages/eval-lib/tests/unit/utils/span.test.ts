import { describe, expect, it } from "vitest"
import { DocumentId } from "../../../src/types/primitives.js"
import {
  spanLength,
  spanOverlapChars,
  spanOverlaps
} from "../../../src/utils/span.js"

describe("spanOverlaps", () => {
  it("should detect overlap in same document", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc1"), start: 30, end: 80 }
    expect(spanOverlaps(a, b)).toBe(true)
  })

  it("should not overlap across different documents", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc2"), start: 0, end: 50 }
    expect(spanOverlaps(a, b)).toBe(false)
  })

  it("should not overlap adjacent spans", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc1"), start: 50, end: 100 }
    expect(spanOverlaps(a, b)).toBe(false)
  })

  it("should not overlap non-adjacent spans", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc1"), start: 100, end: 150 }
    expect(spanOverlaps(a, b)).toBe(false)
  })
})

describe("spanOverlapChars", () => {
  it("should calculate overlap correctly", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc1"), start: 30, end: 80 }
    expect(spanOverlapChars(a, b)).toBe(20)
  })

  it("should return 0 for non-overlapping spans", () => {
    const a = { docId: DocumentId("doc1"), start: 0, end: 50 }
    const b = { docId: DocumentId("doc1"), start: 100, end: 150 }
    expect(spanOverlapChars(a, b)).toBe(0)
  })
})

describe("spanLength", () => {
  it("should return span length", () => {
    expect(spanLength({ docId: DocumentId("doc1"), start: 10, end: 50 })).toBe(
      40
    )
  })
})
