import { describe, it, expect } from "vitest";
import {
  applyThresholdFilter,
  type ScoredChunk,
} from "../../../../../src/retrievers/pipeline/refinement/threshold.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";

function makeChunk(id: string): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: `content-${id}`,
    docId: DocumentId("doc1"),
    start: 0,
    end: 10,
    metadata: {},
  };
}

function makeScoredChunk(id: string, score: number): ScoredChunk {
  return { chunk: makeChunk(id), score };
}

describe("applyThresholdFilter", () => {
  it("filters out results below threshold", () => {
    const results = [makeScoredChunk("a", 0.3), makeScoredChunk("b", 0.7)];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.chunk.id).toBe(PositionAwareChunkId("b"));
    expect(filtered[0]!.score).toBe(0.7);
  });

  it("passes through results above threshold", () => {
    const results = [makeScoredChunk("a", 0.8), makeScoredChunk("b", 0.9)];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.score).toBe(0.8);
    expect(filtered[1]!.score).toBe(0.9);
  });

  it("includes results with score exactly equal to minScore", () => {
    const results = [
      makeScoredChunk("a", 0.5),
      makeScoredChunk("b", 0.4),
      makeScoredChunk("c", 0.6),
    ];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.chunk.id)).toEqual([
      PositionAwareChunkId("a"),
      PositionAwareChunkId("c"),
    ]);
  });

  it("returns empty array when input is empty", () => {
    const filtered = applyThresholdFilter([], 0.5);

    expect(filtered).toEqual([]);
  });

  it("returns empty array when all results are below threshold", () => {
    const results = [
      makeScoredChunk("a", 0.1),
      makeScoredChunk("b", 0.2),
      makeScoredChunk("c", 0.3),
    ];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toEqual([]);
  });

  it("returns all results when none are below threshold", () => {
    const results = [
      makeScoredChunk("a", 0.6),
      makeScoredChunk("b", 0.7),
      makeScoredChunk("c", 0.8),
    ];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toHaveLength(3);
    expect(filtered).toEqual(results);
  });

  it("preserves original ordering of results", () => {
    const results = [
      makeScoredChunk("c", 0.9),
      makeScoredChunk("a", 0.6),
      makeScoredChunk("d", 0.2),
      makeScoredChunk("b", 0.7),
    ];

    const filtered = applyThresholdFilter(results, 0.5);

    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.chunk.id)).toEqual([
      PositionAwareChunkId("c"),
      PositionAwareChunkId("a"),
      PositionAwareChunkId("b"),
    ]);
  });
});
