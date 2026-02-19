import { describe, it, expect } from "vitest";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import {
  weightedScoreFusion,
  reciprocalRankFusion,
} from "../../../../../src/retrievers/pipeline/search/fusion.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/search/fusion.js";

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

function scored(id: string, score: number): ScoredChunk {
  return { chunk: makeChunk(id), score };
}

describe("weightedScoreFusion", () => {
  it("combines scores for a chunk appearing in both lists", () => {
    const denseResults: ScoredChunk[] = [scored("a", 0.8)];
    const sparseResults: ScoredChunk[] = [scored("a", 0.6)];

    const results = weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: 0.7,
      sparseWeight: 0.3,
    });

    expect(results).toHaveLength(1);
    // 0.7 * 0.8 + 0.3 * 0.6 = 0.56 + 0.18 = 0.74
    expect(results[0].score).toBeCloseTo(0.74);
    expect(String(results[0].chunk.id)).toBe("a");
  });

  it("assigns sparseScore=0 for a chunk only in dense results", () => {
    const denseResults: ScoredChunk[] = [scored("a", 0.9)];
    const sparseResults: ScoredChunk[] = [];

    const results = weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: 0.5,
      sparseWeight: 0.5,
    });

    expect(results).toHaveLength(1);
    // 0.5 * 0.9 + 0.5 * 0 = 0.45
    expect(results[0].score).toBeCloseTo(0.45);
  });

  it("assigns denseScore=0 for a chunk only in sparse results", () => {
    const denseResults: ScoredChunk[] = [];
    const sparseResults: ScoredChunk[] = [scored("b", 0.7)];

    const results = weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: 0.5,
      sparseWeight: 0.5,
    });

    expect(results).toHaveLength(1);
    // 0.5 * 0 + 0.5 * 0.7 = 0.35
    expect(results[0].score).toBeCloseTo(0.35);
  });

  it("applies custom weights correctly", () => {
    const denseResults: ScoredChunk[] = [scored("a", 1.0)];
    const sparseResults: ScoredChunk[] = [scored("a", 0.5)];

    const results = weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: 0.3,
      sparseWeight: 0.7,
    });

    expect(results).toHaveLength(1);
    // 0.3 * 1.0 + 0.7 * 0.5 = 0.30 + 0.35 = 0.65
    expect(results[0].score).toBeCloseTo(0.65);
  });

  it("returns results sorted descending by score", () => {
    const denseResults: ScoredChunk[] = [
      scored("a", 0.3),
      scored("b", 0.9),
      scored("c", 0.6),
    ];
    const sparseResults: ScoredChunk[] = [
      scored("a", 0.1),
      scored("b", 0.2),
      scored("c", 0.5),
    ];

    const results = weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: 0.5,
      sparseWeight: 0.5,
    });

    expect(results).toHaveLength(3);
    // b: 0.5*0.9 + 0.5*0.2 = 0.55
    // c: 0.5*0.6 + 0.5*0.5 = 0.55
    // a: 0.5*0.3 + 0.5*0.1 = 0.20
    expect(results[0].score).toBeCloseTo(0.55);
    expect(results[1].score).toBeCloseTo(0.55);
    expect(results[2].score).toBeCloseTo(0.2);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("returns an empty array when both inputs are empty", () => {
    const results = weightedScoreFusion({
      denseResults: [],
      sparseResults: [],
      denseWeight: 0.5,
      sparseWeight: 0.5,
    });

    expect(results).toEqual([]);
  });
});

describe("reciprocalRankFusion", () => {
  it("sums rank contributions for a chunk appearing in both lists", () => {
    const denseResults: ScoredChunk[] = [scored("a", 0.9)];
    const sparseResults: ScoredChunk[] = [
      scored("b", 0.8),
      scored("a", 0.5),
    ];

    const results = reciprocalRankFusion({ denseResults, sparseResults });

    // chunk "a": rank 1 in dense -> 1/61, rank 2 in sparse -> 1/62
    const chunkA = results.find((r) => String(r.chunk.id) === "a")!;
    expect(chunkA).toBeDefined();
    expect(chunkA.score).toBeCloseTo(1 / 61 + 1 / 62);

    // chunk "b": rank 1 in sparse only -> 1/61
    const chunkB = results.find((r) => String(r.chunk.id) === "b")!;
    expect(chunkB).toBeDefined();
    expect(chunkB.score).toBeCloseTo(1 / 61);
  });

  it("gives a single-list contribution for a chunk in only one list", () => {
    const denseResults: ScoredChunk[] = [scored("a", 0.9), scored("b", 0.7)];
    const sparseResults: ScoredChunk[] = [scored("c", 0.8)];

    const results = reciprocalRankFusion({ denseResults, sparseResults });

    expect(results).toHaveLength(3);

    const chunkA = results.find((r) => String(r.chunk.id) === "a")!;
    expect(chunkA.score).toBeCloseTo(1 / 61); // rank 1 in dense only

    const chunkB = results.find((r) => String(r.chunk.id) === "b")!;
    expect(chunkB.score).toBeCloseTo(1 / 62); // rank 2 in dense only

    const chunkC = results.find((r) => String(r.chunk.id) === "c")!;
    expect(chunkC.score).toBeCloseTo(1 / 61); // rank 1 in sparse only
  });

  it("uses configurable k parameter to change scores", () => {
    const denseResults: ScoredChunk[] = [scored("a", 0.9)];
    const sparseResults: ScoredChunk[] = [scored("a", 0.8)];

    const resultsDefaultK = reciprocalRankFusion({
      denseResults,
      sparseResults,
    });
    const resultsCustomK = reciprocalRankFusion({
      denseResults,
      sparseResults,
      k: 10,
    });

    // k=60: rank 1 in both -> 1/61 + 1/61 = 2/61
    expect(resultsDefaultK[0].score).toBeCloseTo(2 / 61);

    // k=10: rank 1 in both -> 1/11 + 1/11 = 2/11
    expect(resultsCustomK[0].score).toBeCloseTo(2 / 11);

    // Custom k=10 produces a higher score than default k=60
    expect(resultsCustomK[0].score).toBeGreaterThan(resultsDefaultK[0].score);
  });

  it("returns results sorted descending by score", () => {
    const denseResults: ScoredChunk[] = [
      scored("a", 0.9),
      scored("b", 0.7),
      scored("c", 0.5),
    ];
    const sparseResults: ScoredChunk[] = [
      scored("c", 0.8),
      scored("b", 0.6),
      scored("a", 0.4),
    ];

    const results = reciprocalRankFusion({ denseResults, sparseResults });

    expect(results).toHaveLength(3);

    // a: rank 1 in dense (1/61), rank 3 in sparse (1/63) -> 1/61 + 1/63
    // b: rank 2 in dense (1/62), rank 2 in sparse (1/62) -> 2/62
    // c: rank 3 in dense (1/63), rank 1 in sparse (1/61) -> 1/63 + 1/61
    // a and c have the same score, b differs
    const scoreA = 1 / 61 + 1 / 63;
    const scoreB = 2 / 62;
    const scoreC = 1 / 63 + 1 / 61;

    expect(results[0].score).toBeCloseTo(scoreA);
    expect(results[1].score).toBeCloseTo(scoreC);
    expect(results[2].score).toBeCloseTo(scoreB);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("returns an empty array when both inputs are empty", () => {
    const results = reciprocalRankFusion({
      denseResults: [],
      sparseResults: [],
    });

    expect(results).toEqual([]);
  });
});
