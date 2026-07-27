import { describe, expect, it } from "vitest"
import { DocumentId } from "../../../src/types/primitives.js"
import {
  normalizedFind,
  spanLength,
  spanOverlapChars,
  spanOverlaps
} from "../../../src/utils/span.js"

describe("normalizedFind", () => {
  const doc = "  Each  pod  runs one or more containers. Pods share storage."

  it("matches ignoring case and collapsed whitespace", () => {
    const r = normalizedFind(doc, "each pod runs one or more containers.")
    expect(r).not.toBeNull()
    expect(doc.substring(r!.start, r!.end)).toBe(
      "Each  pod  runs one or more containers."
    )
  })

  it("maps both ends back to original offsets", () => {
    const r = normalizedFind(doc, "Pods share storage.")
    expect(r).not.toBeNull()
    expect(doc.substring(r!.start, r!.end)).toBe("Pods share storage.")
  })

  it("ignores surrounding whitespace on the excerpt", () => {
    const trimmed = normalizedFind(doc, "Pods share storage.")
    const padded = normalizedFind(doc, "   Pods share storage.   ")
    expect(padded).toEqual(trimmed)
  })

  it("returns null when absent", () => {
    expect(normalizedFind(doc, "not in the document")).toBeNull()
  })

  it("matches excerpts differing from the source only by smart quotes / em-dashes", () => {
    const source = 'The plan - code-named "Alpha" - shipped on time.'
    const excerpt = "code-named “Alpha”"
    const found = normalizedFind(source, excerpt)
    expect(found).not.toBeNull()
    expect(source.slice(found!.start, found!.end)).toBe('code-named "Alpha"')
  })
})

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
