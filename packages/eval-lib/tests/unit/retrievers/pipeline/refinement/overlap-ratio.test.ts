import { describe, it, expect } from "vitest";
import { contentOverlapRatio } from "../../../../../src/retrievers/pipeline/refinement/overlap-ratio.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: "x".repeat(end - start),
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

describe("contentOverlapRatio", () => {
  it("returns 0 for chunks from different documents", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc2", 50, 150);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });

  it("returns 0 for non-overlapping chunks from same document", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 200, 300);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });

  it("returns 1 for identical spans", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 0, 100);
    expect(contentOverlapRatio(a, b)).toBe(1);
  });

  it("computes partial overlap correctly", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 50, 150);
    // overlap = 50 chars (50..100), minLength = 100
    expect(contentOverlapRatio(a, b)).toBe(0.5);
  });

  it("uses min length as denominator", () => {
    const a = makeChunk("a", "doc1", 0, 200); // length 200
    const b = makeChunk("b", "doc1", 100, 150); // length 50, fully inside a
    // overlap = 50, minLength = 50
    expect(contentOverlapRatio(a, b)).toBe(1);
  });

  it("returns 0 for zero-length chunks", () => {
    const a = makeChunk("a", "doc1", 0, 0);
    const b = makeChunk("b", "doc1", 0, 0);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });
});
