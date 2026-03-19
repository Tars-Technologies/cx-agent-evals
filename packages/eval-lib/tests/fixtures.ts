import type { Document, Corpus, CharacterSpan, PositionAwareChunk } from "../src/types/index.js";
import { DocumentId, PositionAwareChunkId } from "../src/types/primitives.js";
import { createDocument, createCorpus } from "../src/types/documents.js";
import type { Embedder } from "../src/embedders/embedder.interface.js";
import type { PipelineLLM } from "../src/retrievers/pipeline/llm.interface.js";

export function sampleDocument(): Document {
  return createDocument({
    id: "test_doc.md",
    content:
      "This is a test document. It has multiple sentences. Each sentence can be a chunk. " +
      "We use it for testing the evaluation framework.",
  });
}

export function sampleCorpus(): Corpus {
  return createCorpus([sampleDocument()]);
}

export function sampleSpans(): CharacterSpan[] {
  return [
    { docId: DocumentId("doc1"), start: 0, end: 50, text: "x".repeat(50) },
    { docId: DocumentId("doc1"), start: 30, end: 80, text: "x".repeat(50) },
    { docId: DocumentId("doc2"), start: 0, end: 100, text: "x".repeat(100) },
  ];
}

export function samplePositionAwareChunks(): PositionAwareChunk[] {
  const doc = sampleDocument();
  return [
    {
      id: PositionAwareChunkId("pa_chunk_aaa"),
      content: doc.content.slice(0, 50),
      docId: doc.id,
      start: 0,
      end: 50,
      metadata: {},
    },
    {
      id: PositionAwareChunkId("pa_chunk_bbb"),
      content: doc.content.slice(50, 100),
      docId: doc.id,
      start: 50,
      end: 100,
      metadata: {},
    },
  ];
}

export function mockEmbedder(dimension: number = 128): Embedder {
  return {
    name: "MockEmbedder",
    dimension,
    async embed(texts: readonly string[]) {
      // Simple hash-based embeddings for deterministic but distinct vectors
      return texts.map((text) => {
        const vec = new Array(dimension).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % dimension] += text.charCodeAt(i) / 1000;
        }
        // Normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        return norm > 0 ? vec.map((v) => v / norm) : vec;
      });
    },
    async embedQuery(query: string) {
      const results = await this.embed([query]);
      return results[0];
    },
  };
}

export function mockLLM(): PipelineLLM {
  return {
    name: "MockLLM",
    async complete() {
      return "mock LLM response";
    },
  };
}
