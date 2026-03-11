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
  private _enc: Tiktoken | null = null;

  constructor(options: TokenChunkerOptions = {}) {
    this._maxTokens = options.maxTokens ?? 256;
    this._overlapTokens = options.overlapTokens ?? 0;
    this._encoding = options.encoding ?? "cl100k_base";

    if (this._overlapTokens >= this._maxTokens) {
      throw new Error("overlapTokens must be less than maxTokens");
    }

    this.name = `Token(tokens=${this._maxTokens})`;
  }

  private _getEncoder(): Tiktoken {
    if (!this._enc) {
      this._enc = getEncoding(
        this._encoding as Parameters<typeof getEncoding>[0],
      );
    }
    return this._enc;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const enc = this._getEncoder();
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
   * an O(N) byte-level scan for multi-byte character safety.
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

    // Fallback: O(N) byte-level offset computation for multi-byte chars.
    //
    // When tokens split a multi-byte UTF-8 character, decoding individual
    // tokens produces replacement chars whose lengths don't sum to the
    // original text length. We fix this by mapping token boundaries to byte
    // boundaries, then converting byte offsets to character offsets via a
    // single scan through the original text's UTF-8 bytes.
    return this._buildCharOffsetsFromBytes(enc, tokens, originalText);
  }

  /**
   * O(N) fallback for _buildCharOffsets when multi-byte characters span
   * token boundaries.
   *
   * Algorithm:
   * 1. Look up each token's raw byte length from the encoder's internal
   *    byte map to build cumulative byte offsets.
   * 2. Encode originalText to UTF-8 bytes.
   * 3. Walk through the UTF-8 bytes one character at a time, mapping each
   *    token's byte boundary to a JS string character position. For byte
   *    offsets that fall mid-character (incomplete UTF-8 sequence), account
   *    for the replacement character that TextDecoder would produce.
   */
  private _buildCharOffsetsFromBytes(
    enc: Tiktoken,
    tokens: number[],
    originalText: string,
  ): number[] {
    // Access the encoder's internal token-to-bytes map. This is a public
    // runtime property on js-tiktoken's Tiktoken class (Map<number, Uint8Array>)
    // but is not exposed in the type definitions.
    const textMap = (enc as unknown as { textMap: Map<number, Uint8Array> })
      .textMap;

    // Step 1: cumulative byte offsets per token boundary
    const byteOffsets: number[] = [0];
    let bytePos = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tokenBytes = textMap.get(tokens[i]);
      bytePos += tokenBytes ? tokenBytes.length : 0;
      byteOffsets.push(bytePos);
    }

    // Step 2: encode original text to UTF-8
    const textBytes = new TextEncoder().encode(originalText);

    // Step 3: single-pass scan converting byte offsets to char offsets.
    //
    // For each character in the original text we know its UTF-8 byte length
    // and its JS string width (1 code unit for BMP, 2 for supplementary).
    // We walk byte-by-byte through the text and, for each token boundary
    // byte offset, compute the corresponding JS string position:
    //   - At a character start boundary: the current char index
    //   - At a character end boundary: the next char index
    //   - Mid-character (incomplete UTF-8): charCount + 1, matching the
    //     single U+FFFD replacement character that TextDecoder produces
    const charOffsets = new Array<number>(byteOffsets.length);
    let charCount = 0;
    let nextIdx = 0;

    // Fill any leading zero byte offsets
    while (nextIdx < byteOffsets.length && byteOffsets[nextIdx] === 0) {
      charOffsets[nextIdx] = 0;
      nextIdx++;
    }

    let b = 0;
    while (b < textBytes.length && nextIdx < byteOffsets.length) {
      // Determine UTF-8 sequence length and JS string width from lead byte
      const lead = textBytes[b];
      let seqLen: number;
      let jsWidth: number;
      if ((lead & 0x80) === 0) {
        seqLen = 1;
        jsWidth = 1;
      } else if ((lead & 0xe0) === 0xc0) {
        seqLen = 2;
        jsWidth = 1;
      } else if ((lead & 0xf0) === 0xe0) {
        seqLen = 3;
        jsWidth = 1;
      } else {
        seqLen = 4;
        jsWidth = 2; // supplementary character = surrogate pair
      }

      const charEndByte = b + seqLen;

      // Resolve all byte offsets that fall within this character's range
      while (
        nextIdx < byteOffsets.length &&
        byteOffsets[nextIdx] <= charEndByte
      ) {
        const bo = byteOffsets[nextIdx];
        if (bo === b) {
          // Exactly at character start
          charOffsets[nextIdx] = charCount;
        } else if (bo === charEndByte) {
          // Exactly at character end (= next character start)
          charOffsets[nextIdx] = charCount + jsWidth;
        } else {
          // Mid-character: incomplete UTF-8 produces one replacement char
          charOffsets[nextIdx] = charCount + 1;
        }
        nextIdx++;
      }

      charCount += jsWidth;
      b = charEndByte;
    }

    // Handle any remaining offsets at or past the end of the byte stream
    while (nextIdx < byteOffsets.length) {
      charOffsets[nextIdx] = charCount;
      nextIdx++;
    }

    return charOffsets;
  }
}
