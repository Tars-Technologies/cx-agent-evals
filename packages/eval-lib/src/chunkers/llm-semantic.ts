import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { PipelineLLM } from "../retrievers/pipeline/llm.interface.js";
import { splitIntoSegments, type TextSegment } from "./segment-utils.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface LLMSemanticChunkerOptions {
  /** Characters per segment sent to the LLM. @default 50 */
  segmentSize?: number;
  /** Total characters per LLM batch call. @default 800 */
  batchSize?: number;
}

const SPLIT_PROMPT = `You are a document segmentation expert. The following text has been split into numbered segments, each wrapped with tags like <|start_segment_N|> and <|end_segment_N|>.

Identify which segments mark the END of a thematic section. Return ONLY the segment numbers after which a split should occur, in ascending order.

Format your response EXACTLY as:
split_after: 2, 5, 8

If no thematic boundaries are found, respond EXACTLY as:
split_after: none

Tagged text:
`;

export class LLMSemanticChunker implements AsyncPositionAwareChunker {
  readonly name = "LLMSemantic";
  readonly async = true as const;

  private readonly _llm: PipelineLLM;
  private readonly _segmentSize: number;
  private readonly _batchSize: number;

  constructor(llm: PipelineLLM, options?: LLMSemanticChunkerOptions) {
    this._llm = llm;
    this._segmentSize = options?.segmentSize ?? 50;
    this._batchSize = options?.batchSize ?? 800;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const segments = splitIntoSegments(doc.content, this._segmentSize);
    if (segments.length === 0) return [];

    if (segments.length === 1) {
      return [makeChunk(doc, segments)];
    }

    const tagged = segments.map(
      (seg, i) => `<|start_segment_${i}|>${seg.text}<|end_segment_${i}|>`,
    );

    const batches = this._createBatches(tagged);

    const splitPoints = new Set<number>();

    for (const batch of batches) {
      const prompt = SPLIT_PROMPT + batch.text;
      const response = await this._llm.complete(prompt);
      const points = parseSplitPoints(response, batch.startIdx, batch.endIdx);
      for (const p of points) {
        splitPoints.add(p);
      }
    }

    const sortedSplits = [...splitPoints].sort((a, b) => a - b);
    const groups: TextSegment[][] = [];
    let groupStart = 0;

    for (const splitAfter of sortedSplits) {
      if (splitAfter + 1 <= groupStart || splitAfter >= segments.length) continue;
      groups.push(segments.slice(groupStart, splitAfter + 1));
      groupStart = splitAfter + 1;
    }
    if (groupStart < segments.length) {
      groups.push(segments.slice(groupStart));
    }

    return groups.map((group) => makeChunk(doc, group));
  }

  private _createBatches(
    tagged: string[],
  ): Array<{ text: string; startIdx: number; endIdx: number; count: number }> {
    const batches: Array<{
      text: string;
      startIdx: number;
      endIdx: number;
      count: number;
    }> = [];
    let currentBatch: string[] = [];
    let currentLength = 0;
    let batchStart = 0;

    for (let i = 0; i < tagged.length; i++) {
      const taggedLen = tagged[i]!.length;

      if (currentLength + taggedLen > this._batchSize && currentBatch.length > 0) {
        batches.push({
          text: currentBatch.join("\n"),
          startIdx: batchStart,
          endIdx: batchStart + currentBatch.length - 1,
          count: currentBatch.length,
        });
        batchStart = i;
        currentBatch = [];
        currentLength = 0;
      }

      currentBatch.push(tagged[i]!);
      currentLength += taggedLen;
    }

    if (currentBatch.length > 0) {
      batches.push({
        text: currentBatch.join("\n"),
        startIdx: batchStart,
        endIdx: batchStart + currentBatch.length - 1,
        count: currentBatch.length,
      });
    }

    return batches;
  }
}

function parseSplitPoints(
  response: string,
  batchStartIdx: number,
  batchEndIdx: number,
): number[] {
  const match = response.match(/split_after:\s*(.+)/i);
  if (!match) return [];

  const value = match[1]!.trim();
  if (value.toLowerCase() === "none") return [];

  const points: number[] = [];
  for (const part of value.split(",")) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= batchStartIdx && num <= batchEndIdx) {
      points.push(num);
    }
  }

  return points.sort((a, b) => a - b);
}

function makeChunk(doc: Document, segs: TextSegment[]): PositionAwareChunk {
  const start = segs[0]!.start;
  const end = segs[segs.length - 1]!.end;
  const content = doc.content.slice(start, end);

  return {
    id: generatePaChunkId(content, String(doc.id), start),
    content,
    docId: doc.id,
    start,
    end,
    metadata: {},
  };
}
