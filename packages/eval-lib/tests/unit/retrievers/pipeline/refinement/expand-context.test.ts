import { describe, it, expect } from "vitest";
import { applyExpandContext } from "../../../../../src/retrievers/pipeline/refinement/expand-context.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/types.js";
import type { Corpus, Document } from "../../../../../src/types/index.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeCorpus(docs: Document[]): Corpus {
  return { documents: docs, metadata: {} };
}

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
  content: string,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyExpandContext", () => {
  const docContent = "0123456789".repeat(10); // 100 chars
  const corpus = makeCorpus([makeDoc("doc1", docContent)]);

  it("expands chunk by windowChars in both directions", () => {
    const chunk = makeChunk("a", "doc1", 30, 50, docContent.slice(30, 50));
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 10);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.chunk.start).toBe(20);
    expect(expanded[0]!.chunk.end).toBe(60);
    expect(expanded[0]!.chunk.content).toBe(docContent.slice(20, 60));
    expect(expanded[0]!.score).toBe(0.9); // score preserved
  });

  it("clamps expansion to document boundaries", () => {
    const chunk = makeChunk("a", "doc1", 5, 15, docContent.slice(5, 15));
    const results = [scored(chunk, 0.8)];

    const expanded = applyExpandContext(results, corpus, 20);

    expect(expanded[0]!.chunk.start).toBe(0); // clamped to 0
    expect(expanded[0]!.chunk.end).toBe(35);
  });

  it("clamps at end of document", () => {
    const chunk = makeChunk("a", "doc1", 90, 100, docContent.slice(90, 100));
    const results = [scored(chunk, 0.7)];

    const expanded = applyExpandContext(results, corpus, 20);

    expect(expanded[0]!.chunk.start).toBe(70);
    expect(expanded[0]!.chunk.end).toBe(100); // clamped to doc length
  });

  it("returns chunk unchanged when doc not found in corpus", () => {
    const chunk = makeChunk("a", "unknown", 0, 10, "some text");
    const results = [scored(chunk, 0.5)];

    const expanded = applyExpandContext(results, corpus, 10);

    expect(expanded[0]!.chunk.start).toBe(0);
    expect(expanded[0]!.chunk.end).toBe(10);
    expect(expanded[0]!.chunk.content).toBe("some text");
  });

  it("handles empty results", () => {
    expect(applyExpandContext([], corpus, 10)).toEqual([]);
  });

  it("preserves chunk metadata", () => {
    const chunk: PositionAwareChunk = {
      id: PositionAwareChunkId("a"),
      content: docContent.slice(30, 50),
      docId: DocumentId("doc1"),
      start: 30,
      end: 50,
      metadata: { source: "test" },
    };
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 10);
    expect(expanded[0]!.chunk.metadata).toEqual({ source: "test" });
  });

  it("handles windowChars=0 (no expansion)", () => {
    const chunk = makeChunk("a", "doc1", 30, 50, docContent.slice(30, 50));
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 0);

    expect(expanded[0]!.chunk.start).toBe(30);
    expect(expanded[0]!.chunk.end).toBe(50);
  });
});
