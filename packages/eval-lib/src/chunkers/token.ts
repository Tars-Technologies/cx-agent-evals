import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
import { getEncoding } from "js-tiktoken";
import type { Tiktoken } from "js-tiktoken";

export interface TokenChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
  encoding?: string;
}

export class TokenChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxTokens: number;
  private readonly _overlapTokens: number;
  private readonly _encoding: string;

  constructor(options: TokenChunkerOptions = {}) {
    this._maxTokens = options.maxTokens ?? 256;
    this._overlapTokens = options.overlapTokens ?? 0;
    this._encoding = options.encoding ?? "cl100k_base";

    if (this._overlapTokens >= this._maxTokens) {
      throw new Error("overlapTokens must be less than maxTokens");
    }

    this.name = `Token(tokens=${this._maxTokens})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const enc = getEncoding(
      this._encoding as Parameters<typeof getEncoding>[0],
    );
    const tokens = enc.encode(doc.content);

    if (tokens.length === 0) return [];

    const charOffsets = this._buildCharOffsets(enc, tokens, doc.content);
    const step = this._maxTokens - this._overlapTokens;
    const results: PositionAwareChunk[] = [];

    for (let i = 0; i < tokens.length; i += step) {
      const end = Math.min(i + this._maxTokens, tokens.length);
      const charStart = charOffsets[i];
      const charEnd = charOffsets[end];
      const raw = doc.content.slice(charStart, charEnd);
      const content = raw.trim();

      if (content.length === 0) continue;

      const trimOffset = raw.indexOf(content);
      const adjStart = charStart + trimOffset;

      results.push({
        id: generatePaChunkId(content, String(doc.id), adjStart),
        content,
        docId: doc.id,
        start: adjStart,
        end: adjStart + content.length,
        metadata: {},
      });

      if (end >= tokens.length) break;
    }

    return results;
  }

  /**
   * Build a cumulative character offset array: charOffsets[i] = character
   * position in originalText where token i starts.
   *
   * Uses per-token decode with a roundtrip verification. Falls back to
   * prefix-decode at chunk boundaries for multi-byte character safety.
   */
  private _buildCharOffsets(
    enc: Tiktoken,
    tokens: number[],
    originalText: string,
  ): number[] {
    // Fast path: decode each token individually and sum lengths
    const offsets: number[] = [0];
    let cumLen = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tokenText = enc.decode([tokens[i]]);
      cumLen += tokenText.length;
      offsets.push(cumLen);
    }

    // Verify roundtrip: cumulative length should match original text length
    if (cumLen === originalText.length) {
      return offsets;
    }

    // Slow fallback: decode prefixes for accuracy with multi-byte chars
    const safeOffsets: number[] = [0];
    for (let i = 1; i <= tokens.length; i++) {
      safeOffsets.push(enc.decode(tokens.slice(0, i)).length);
    }
    return safeOffsets;
  }
}
