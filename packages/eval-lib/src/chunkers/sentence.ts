import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
import { splitSentences } from "./segment-utils.js";

export interface SentenceChunkerOptions {
  /**
   * Maximum character length for grouped sentence chunks. Individual sentences
   * exceeding this limit are emitted as-is (sentence integrity is preserved
   * over strict size enforcement).
   */
  maxChunkSize?: number;
  overlapSentences?: number;
}

export class SentenceChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxChunkSize: number;
  private readonly _overlapSentences: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this._maxChunkSize = options.maxChunkSize ?? 1000;
    this._overlapSentences = options.overlapSentences ?? 0;

    if (this._maxChunkSize <= 0) {
      throw new Error("maxChunkSize must be positive");
    }
    if (this._overlapSentences < 0) {
      throw new Error("overlapSentences must be non-negative");
    }

    this.name = `Sentence(size=${this._maxChunkSize})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const sentences = splitSentences(doc.content);
    if (sentences.length === 0) return [];

    const results: PositionAwareChunk[] = [];
    let group: Array<{ text: string; start: number; end: number }> = [];

    for (const sentence of sentences) {
      const groupStart = group.length > 0 ? group[0].start : sentence.start;
      const potentialLen = sentence.end - groupStart;

      if (potentialLen > this._maxChunkSize && group.length > 0) {
        this._emitGroup(doc, group, results);

        if (this._overlapSentences > 0) {
          group = group.slice(-this._overlapSentences);
        } else {
          group = [];
        }
      }

      group.push(sentence);
    }

    if (group.length > 0) {
      this._emitGroup(doc, group, results);
    }

    return results;
  }

  private _emitGroup(
    doc: Document,
    sentences: Array<{ text: string; start: number; end: number }>,
    results: PositionAwareChunk[],
  ): void {
    const start = sentences[0].start;
    const end = sentences[sentences.length - 1].end;
    const content = doc.content.slice(start, end);

    results.push({
      id: generatePaChunkId(content, String(doc.id), start),
      content,
      docId: doc.id,
      start,
      end,
      metadata: {},
    });
  }

}
