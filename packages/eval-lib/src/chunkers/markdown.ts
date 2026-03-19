import type { Document, PositionAwareChunk } from "../types/index.js";
import { generatePaChunkId } from "../utils/hashing.js";
import { createDocument } from "../types/documents.js";
import type { Chunker, PositionAwareChunker } from "./chunker.interface.js";
import { RecursiveCharacterChunker } from "./recursive-character.js";

export interface MarkdownChunkerOptions {
  maxChunkSize?: number;
  headerLevels?: number[];
  mergeSmallSections?: boolean;
}

export class MarkdownChunker implements Chunker, PositionAwareChunker {
  readonly name: string;
  private readonly _maxChunkSize: number;
  private readonly _headerLevels: Set<number>;
  private readonly _mergeSmallSections: boolean;

  constructor(options: MarkdownChunkerOptions = {}) {
    this._maxChunkSize = options.maxChunkSize ?? 1000;
    this._headerLevels = new Set(options.headerLevels ?? [1, 2, 3]);
    this._mergeSmallSections = options.mergeSmallSections ?? true;
    this.name = `Markdown(size=${this._maxChunkSize})`;
  }

  chunk(text: string): string[] {
    const doc = createDocument({ id: "_chunk_", content: text });
    return this.chunkWithPositions(doc).map((c) => c.content);
  }

  chunkWithPositions(doc: Document): PositionAwareChunk[] {
    if (doc.content.trim().length === 0) return [];

    const sections = this._splitAtHeaders(doc.content);
    if (sections.length === 0) return [];

    const merged = this._mergeSmallSections
      ? this._merge(sections)
      : sections;

    const results: PositionAwareChunk[] = [];

    for (const section of merged) {
      const sectionLen = section.end - section.start;

      if (sectionLen <= this._maxChunkSize) {
        const content = doc.content.slice(section.start, section.end);
        results.push({
          id: generatePaChunkId(content, String(doc.id), section.start),
          content,
          docId: doc.id,
          start: section.start,
          end: section.end,
          metadata: {},
        });
      } else {
        // Sub-split large sections via RecursiveCharacterChunker
        this._subSplit(doc, section, results);
      }
    }

    return results;
  }

  /**
   * Find header lines matching configured levels and split text into sections.
   * Each section runs from a header to the start of the next header (trimmed).
   * Content before the first header becomes its own section.
   */
  private _splitAtHeaders(
    text: string,
  ): Array<{ start: number; end: number }> {
    const headerPattern = /^(#{1,6})\s+(.+)$/gm;
    const boundaries: number[] = [];

    let match;
    while ((match = headerPattern.exec(text)) !== null) {
      const level = match[1].length;
      if (this._headerLevels.has(level)) {
        boundaries.push(match.index);
      }
    }

    if (boundaries.length === 0) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return [];
      const trimStart = text.indexOf(trimmed);
      return [{ start: trimStart, end: trimStart + trimmed.length }];
    }

    const sections: Array<{ start: number; end: number }> = [];

    // Content before first header (if any)
    if (boundaries[0] > 0) {
      const pre = text.slice(0, boundaries[0]).trim();
      if (pre.length > 0) {
        const trimStart = text.indexOf(pre);
        sections.push({ start: trimStart, end: trimStart + pre.length });
      }
    }

    // Each header section
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const rawEnd =
        i < boundaries.length - 1 ? boundaries[i + 1] : text.length;
      const sectionText = text.slice(start, rawEnd);
      const trimmed = sectionText.trimEnd();
      if (trimmed.length > 0) {
        sections.push({ start, end: start + trimmed.length });
      }
    }

    return sections;
  }

  /**
   * Merge adjacent sections when their combined span fits within maxChunkSize.
   * Merged content is doc.content.slice(firstStart, lastEnd) -- preserves
   * original whitespace between sections.
   */
  private _merge(
    sections: Array<{ start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    if (sections.length <= 1) return sections;

    const merged: Array<{ start: number; end: number }> = [];
    let currentStart = sections[0].start;
    let currentEnd = sections[0].end;

    for (let i = 1; i < sections.length; i++) {
      const next = sections[i];
      const mergedLen = next.end - currentStart;

      if (mergedLen <= this._maxChunkSize) {
        currentEnd = next.end;
      } else {
        merged.push({ start: currentStart, end: currentEnd });
        currentStart = next.start;
        currentEnd = next.end;
      }
    }

    merged.push({ start: currentStart, end: currentEnd });
    return merged;
  }

  /**
   * Sub-split a large section using RecursiveCharacterChunker, then adjust
   * all chunk positions by the section's base offset.
   */
  private _subSplit(
    doc: Document,
    section: { start: number; end: number },
    results: PositionAwareChunk[],
  ): void {
    const sectionText = doc.content.slice(section.start, section.end);
    const subDoc = createDocument({ id: String(doc.id), content: sectionText });
    const subChunker = new RecursiveCharacterChunker({
      chunkSize: this._maxChunkSize,
      chunkOverlap: 0,
    });
    const subChunks = subChunker.chunkWithPositions(subDoc);

    for (const sub of subChunks) {
      const adjStart = sub.start + section.start;
      results.push({
        id: generatePaChunkId(sub.content, String(doc.id), adjStart),
        content: sub.content,
        docId: doc.id,
        start: adjStart,
        end: adjStart + sub.content.length,
        metadata: {},
      });
    }
  }
}
