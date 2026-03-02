import { describe, it, expect } from "vitest";
import { BM25SearchIndex } from "../../../../../src/retrievers/pipeline/search/bm25.js";
import type { PositionAwareChunk } from "../../../../../src/types/chunks.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";

function makeChunk(id: string, content: string): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc1"),
    start: 0,
    end: content.length,
    metadata: {},
  };
}

const CHUNKS: readonly PositionAwareChunk[] = [
  makeChunk("chunk-1", "The quick brown fox jumps over the lazy dog"),
  makeChunk("chunk-2", "Machine learning and artificial intelligence research"),
  makeChunk("chunk-3", "TypeScript programming language features and syntax"),
  makeChunk("chunk-4", "The fox and the dog played in the garden"),
];

describe("BM25SearchIndex", () => {
  describe("build + search", () => {
    it("returns matching chunks for a relevant query", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const results = index.search("fox dog", 10);

      expect(results.length).toBeGreaterThan(0);

      const ids = results.map((c) => c.id as string);
      expect(ids).toContain("chunk-1");
      expect(ids).toContain("chunk-4");
    });

    it("ranks the most relevant chunk first", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const results = index.search("machine learning artificial intelligence", 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(PositionAwareChunkId("chunk-2"));
    });
  });

  describe("search returns empty", () => {
    it("returns empty array when no matches for query", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const results = index.search("xylophone quantum entanglement", 10);

      expect(results).toEqual([]);
    });

    it("returns empty array when index has not been built", () => {
      const index = new BM25SearchIndex();

      const results = index.search("fox", 10);

      expect(results).toEqual([]);
    });
  });

  describe("searchWithScores", () => {
    it("returns scores in the [0, 1] range", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const scored = index.searchWithScores("fox dog", 10);

      expect(scored.length).toBeGreaterThan(0);
      for (const { score } of scored) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it("assigns a score of 1.0 to the top result", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const scored = index.searchWithScores("TypeScript programming", 10);

      expect(scored.length).toBeGreaterThan(0);
      expect(scored[0].score).toBe(1.0);
    });

    it("returns chunks alongside their scores", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const scored = index.searchWithScores("fox", 10);

      for (const { chunk, score } of scored) {
        expect(chunk).toBeDefined();
        expect(chunk.content).toBeTruthy();
        expect(typeof score).toBe("number");
      }
    });
  });

  describe("search respects k limit", () => {
    it("returns at most k results", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const results = index.search("the", 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("returns fewer than k when fewer chunks match", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const results = index.search("TypeScript syntax", 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(CHUNKS.length);
    });
  });

  describe("clear", () => {
    it("resets the index so search returns empty", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      // Verify search works before clearing
      const before = index.search("fox", 10);
      expect(before.length).toBeGreaterThan(0);

      index.clear();

      const after = index.search("fox", 10);
      expect(after).toEqual([]);
    });

    it("resets the index so searchWithScores returns empty", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      index.clear();

      const after = index.searchWithScores("fox", 10);
      expect(after).toEqual([]);
    });
  });

  describe("custom k1/b params", () => {
    it("accepts custom BM25 parameters and still returns results", () => {
      const index = new BM25SearchIndex({ k1: 1.5, b: 0.5 });
      index.build(CHUNKS);

      const results = index.search("fox dog", 10);

      expect(results.length).toBeGreaterThan(0);
    });

    it("accepts partial options with only k1", () => {
      const index = new BM25SearchIndex({ k1: 2.0 });
      index.build(CHUNKS);

      const results = index.search("machine learning", 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(PositionAwareChunkId("chunk-2"));
    });

    it("accepts partial options with only b", () => {
      const index = new BM25SearchIndex({ b: 0.9 });
      index.build(CHUNKS);

      const results = index.search("programming language", 10);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("rebuild", () => {
    it("replaces the previous index when build is called again", () => {
      const index = new BM25SearchIndex();
      index.build(CHUNKS);

      const newChunks = [
        makeChunk("new-1", "Quantum computing and cryptography advances"),
      ];
      index.build(newChunks);

      const oldResults = index.search("fox dog", 10);
      expect(oldResults).toEqual([]);

      const newResults = index.search("quantum computing", 10);
      expect(newResults.length).toBe(1);
      expect(newResults[0].id).toBe(PositionAwareChunkId("new-1"));
    });
  });

  describe("edge cases", () => {
    it("returns empty when built with an empty chunk array", () => {
      const index = new BM25SearchIndex();
      index.build([]);

      const results = index.search("fox", 10);
      expect(results).toEqual([]);
    });

    it("returns empty scores when built with an empty chunk array", () => {
      const index = new BM25SearchIndex();
      index.build([]);

      const scored = index.searchWithScores("fox", 10);
      expect(scored).toEqual([]);
    });

    it("indexes both chunks when two have identical content", () => {
      const index = new BM25SearchIndex();
      const duplicateChunks = [
        makeChunk("dup-1", "The quick brown fox jumps over the lazy dog"),
        makeChunk("dup-2", "The quick brown fox jumps over the lazy dog"),
      ];
      index.build(duplicateChunks);

      const results = index.search("quick brown fox", 10);

      expect(results.length).toBe(2);
      const ids = results.map((c) => c.id as string);
      expect(ids).toContain("dup-1");
      expect(ids).toContain("dup-2");
    });
  });
});
