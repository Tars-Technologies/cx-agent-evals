import { describe, it, expect } from "vitest";
import { applyMmr } from "../../../../../src/retrievers/pipeline/refinement/mmr.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/types.js";

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

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyMmr", () => {
  it("returns empty array for empty input", () => {
    expect(applyMmr([], 5, 0.7)).toEqual([]);
  });

  it("returns all results when k >= input length", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.7),
    ];

    const selected = applyMmr(results, 5, 0.7);
    expect(selected).toHaveLength(2);
  });

  it("selects highest-scored first with lambda=1.0 (pure relevance)", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc1", 10, 110), 0.8), // overlaps with a
      scored(makeChunk("c", "doc1", 500, 600), 0.7),
    ];

    const selected = applyMmr(results, 2, 1.0);
    // With lambda=1.0, MMR = 1.0 * relevance - 0, so just picks by score
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("b"));
  });

  it("prefers diverse results with lambda=0.0 (pure diversity)", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc1", 10, 110), 0.8), // high overlap with a
      scored(makeChunk("c", "doc1", 500, 600), 0.7), // no overlap with a
    ];

    const selected = applyMmr(results, 2, 0.0);
    // First pick: a (highest mmr when S is empty)
    // Second pick: c wins (no overlap with a → maxSim=0, mmrScore=0)
    //              b loses (high overlap with a → maxSim≈0.9, mmrScore=-0.9)
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("c"));
  });

  it("treats cross-document chunks as fully diverse", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.8), // same span, different doc
      scored(makeChunk("c", "doc1", 0, 100), 0.7), // same span, same doc as a
    ];

    const selected = applyMmr(results, 2, 0.5);
    // First: a (highest score when S empty)
    // b: maxSim=0 (different doc), mmr = 0.5*0.8 - 0 = 0.4
    // c: maxSim=1.0 (same span as a), mmr = 0.5*0.7 - 0.5*1.0 = -0.15
    // b wins
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("b"));
  });

  it("limits output to k results", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.8),
      scored(makeChunk("c", "doc3", 0, 100), 0.7),
    ];

    const selected = applyMmr(results, 2, 0.7);
    expect(selected).toHaveLength(2);
  });
});
