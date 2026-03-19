import { describe, it, expect } from "vitest";
import { applyDedup } from "../../../../../src/retrievers/pipeline/refinement/dedup.js";
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
  content?: string,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: content ?? `content-${id}`,
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyDedup", () => {
  describe("exact method", () => {
    it("removes chunks with identical content, keeps first (highest-scored)", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 10, "hello world"), 0.9),
        scored(makeChunk("b", "doc1", 20, 30, "hello world"), 0.7),
        scored(makeChunk("c", "doc1", 40, 50, "different"), 0.5),
      ];

      const deduped = applyDedup(results, "exact", 0.5);

      expect(deduped).toHaveLength(2);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
      expect(deduped[1]!.chunk.id).toBe(PositionAwareChunkId("c"));
    });

    it("returns empty array for empty input", () => {
      expect(applyDedup([], "exact", 0.5)).toEqual([]);
    });

    it("keeps all chunks when content is unique", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 5, "alpha"), 0.9),
        scored(makeChunk("b", "doc1", 10, 15, "beta"), 0.7),
      ];

      expect(applyDedup(results, "exact", 0.5)).toHaveLength(2);
    });

    it("deduplicates across different documents", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 10, "same text"), 0.9),
        scored(makeChunk("b", "doc2", 0, 10, "same text"), 0.7),
      ];

      const deduped = applyDedup(results, "exact", 0.5);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    });
  });

  describe("overlap method", () => {
    it("removes chunks with high span overlap from same document", () => {
      // Chunk a: 0-100, chunk b: 10-110 → overlap 90, min length 100 → ratio 0.9
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 10, 110), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);

      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    });

    it("keeps chunks with low overlap", () => {
      // Chunk a: 0-100, chunk b: 90-200 → overlap 10, min length 100 → ratio 0.1
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 90, 200), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(2);
    });

    it("never removes cross-document chunks via overlap", () => {
      // Same spans but different docs → overlap = 0
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc2", 0, 100), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(2);
    });

    it("handles threshold boundary (equal to threshold is a duplicate)", () => {
      // Chunk a: 0-100, chunk b: 50-150 → overlap 50, min length 100 → ratio 0.5
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 50, 150), 0.7),
      ];

      // threshold = 0.5, ratio = 0.5 → duplicate (>= threshold, not strictly >)
      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(1);
    });

    it("preserves order of kept results", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 500, 600), 0.8),
        scored(makeChunk("c", "doc1", 10, 110), 0.7), // overlaps with a
        scored(makeChunk("d", "doc1", 1000, 1100), 0.6),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped.map((r) => r.chunk.id)).toEqual([
        PositionAwareChunkId("a"),
        PositionAwareChunkId("b"),
        PositionAwareChunkId("d"),
      ]);
    });
  });
});
