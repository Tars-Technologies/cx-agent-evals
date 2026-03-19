import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";

export interface RecursiveCharacterChunkerOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export class RecursiveCharacterChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private _chunkSize: number;
  private _chunkOverlap: number;
  private _separators: string[];

  constructor(options: RecursiveCharacterChunkerOptions = {}) {
    this._chunkSize = options.chunkSize ?? 1000;
    this._chunkOverlap = options.chunkOverlap ?? 200;
    this._separators = options.separators ?? DEFAULT_SEPARATORS;

    if (this._chunkOverlap >= this._chunkSize) {
      throw new Error("chunkOverlap must be less than chunkSize");
    }

    this.name = `RecursiveCharacter(size=${this._chunkSize}, overlap=${this._chunkOverlap})`;
  }

  chunk(text: string): string[] {
    return this._splitTextWithPositions(text, this._separators, 0).map(([t]) => t);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    return this._splitTextWithPositions(doc.content, this._separators, 0).map(
      ([text, start, end]) => ({
        id: generatePaChunkId(text, String(doc.id), start),
        content: text,
        docId: doc.id,
        start,
        end,
        metadata: {},
      }),
    );
  }

  private _splitTextWithPositions(
    text: string,
    separators: string[],
    baseOffset: number,
  ): Array<[string, number, number]> {
    if (text.trim().length === 0) return [];
    if (text.length <= this._chunkSize) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return [];
      const trimStart = text.indexOf(trimmed);
      return [[trimmed, baseOffset + trimStart, baseOffset + trimStart + trimmed.length]];
    }

    // Find the best separator that exists in the text
    let separator = "";
    let nextSeparators: string[] = [];
    for (let i = 0; i < separators.length; i++) {
      if (separators[i] === "") {
        separator = "";
        nextSeparators = [];
        break;
      }
      if (text.includes(separators[i])) {
        separator = separators[i];
        nextSeparators = separators.slice(i + 1);
        break;
      }
    }

    // Split text by separator, tracking positions
    const pieces: Array<{ text: string; offset: number }> = [];
    if (separator === "") {
      // Character-level: just do fixed-width splits
      for (let i = 0; i < text.length; i += this._chunkSize - this._chunkOverlap) {
        const slice = text.substring(i, i + this._chunkSize).trim();
        if (slice.length > 0) {
          const trimStart = text.substring(i, i + this._chunkSize).indexOf(slice);
          pieces.push({ text: slice, offset: baseOffset + i + trimStart });
        }
      }
      return pieces.map((p) => [p.text, p.offset, p.offset + p.text.length]);
    }

    // Split by separator
    const parts: Array<{ text: string; offset: number }> = [];
    let pos = 0;
    const rawParts = text.split(separator);
    for (const part of rawParts) {
      parts.push({ text: part, offset: pos });
      pos += part.length + separator.length;
    }

    // Merge parts into chunks that fit within chunkSize
    const results: Array<[string, number, number]> = [];
    let currentParts: Array<{ text: string; offset: number }> = [];
    let currentLen = 0;

    const emitCurrent = () => {
      if (currentParts.length === 0) return;
      const merged = currentParts.map((p) => p.text).join(separator);
      const trimmed = merged.trim();
      if (trimmed.length === 0) return;

      const startOffset = baseOffset + currentParts[0].offset;

      if (trimmed.length > this._chunkSize && nextSeparators.length > 0) {
        results.push(
          ...this._splitTextWithPositions(trimmed, nextSeparators, startOffset),
        );
      } else {
        results.push([trimmed, startOffset, startOffset + trimmed.length]);
      }
    };

    for (const part of parts) {
      const addLen = currentLen === 0 ? part.text.length : separator.length + part.text.length;

      if (currentLen + addLen > this._chunkSize && currentParts.length > 0) {
        emitCurrent();

        // Keep overlap: retain at most chunkOverlap characters from the tail
        if (this._chunkOverlap > 0) {
          // Drop parts from the front until the remaining fits within chunkOverlap
          while (currentParts.length > 0) {
            const dropLen = currentParts[0].text.length + separator.length;
            if (currentLen - dropLen <= this._chunkOverlap) break;
            currentLen -= dropLen;
            currentParts.shift();
          }
          // Safety: if a single part alone exceeds chunkOverlap (large paragraph),
          // clear it to prevent duplicate emission on the next cycle.
          if (currentParts.length === 1 && currentLen > this._chunkOverlap) {
            currentParts = [];
            currentLen = 0;
          }
        } else {
          currentParts = [];
          currentLen = 0;
        }
      }

      currentParts.push(part);
      currentLen = currentParts.map((p) => p.text).join(separator).length;
    }

    emitCurrent();
    return results;
  }
}
