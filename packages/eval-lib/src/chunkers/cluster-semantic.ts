import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import { splitIntoSegments, type TextSegment } from "./segment-utils.js";
import { cosineSimilarity } from "../utils/similarity.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface ClusterSemanticChunkerOptions {
  /** Maximum chunk size in characters. @default 400 */
  readonly maxChunkSize?: number;
  /** Characters per micro-segment before clustering. @default 50 */
  readonly segmentSize?: number;
}

/**
 * Semantic chunker that embeds micro-segments and uses dynamic programming
 * to find optimal chunk boundaries that maximize intra-chunk similarity.
 *
 * Algorithm:
 * 1. Split text into small segments (~segmentSize chars each).
 * 2. Embed all segments in a single batch call.
 * 3. Run DP over segments: dp[i] = best total similarity score for
 *    segments 0..i, where each group of consecutive segments forms a chunk
 *    not exceeding maxChunkSize.
 * 4. Backtrack through parent pointers to recover optimal boundaries.
 */
export class ClusterSemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string;
  readonly async = true as const;

  private readonly _embedder: Embedder;
  private readonly _maxChunkSize: number;
  private readonly _segmentSize: number;

  constructor(embedder: Embedder, options?: ClusterSemanticChunkerOptions) {
    this._embedder = embedder;
    this._maxChunkSize = options?.maxChunkSize ?? 400;
    this._segmentSize = options?.segmentSize ?? 50;
    this.name = `ClusterSemantic(size=${this._maxChunkSize})`;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const segments = splitIntoSegments(doc.content, this._segmentSize);
    if (segments.length === 0) return [];

    if (segments.length === 1) {
      return [this._makeChunk(doc, segments)];
    }

    const embeddings = await this._embedder.embed(
      segments.map((s) => s.text),
    );

    const boundaries = findOptimalBoundaries(
      segments,
      embeddings,
      this._maxChunkSize,
    );

    return boundaries.map(([startIdx, endIdx]) =>
      this._makeChunk(doc, segments.slice(startIdx, endIdx + 1)),
    );
  }

  private _makeChunk(
    doc: Document,
    segs: readonly TextSegment[],
  ): PositionAwareChunk {
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
}

/**
 * DP to find chunk boundaries that maximize total intra-chunk similarity.
 *
 * dp[i] = best total similarity for segments 0..i
 * parent[i] = start index of the chunk ending at segment i in the optimal solution
 *
 * Transition: for each i, try every j <= i such that the character span
 * from segment j to segment i does not exceed maxChunkSize.
 */
function findOptimalBoundaries(
  segments: readonly TextSegment[],
  embeddings: readonly number[][],
  maxChunkSize: number,
): ReadonlyArray<[number, number]> {
  const n = segments.length;
  const dp = new Array<number>(n).fill(-Infinity);
  const parent = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    let chunkLength = 0;
    for (let j = i; j >= 0; j--) {
      chunkLength += segments[j]!.end - segments[j]!.start;
      if (chunkLength > maxChunkSize) break;

      const prevScore = j > 0 ? dp[j - 1]! : 0;
      const similarity = avgPairwiseSimilarity(embeddings, j, i);
      const totalScore = prevScore + similarity;

      if (totalScore > dp[i]!) {
        dp[i] = totalScore;
        parent[i] = j;
      }
    }
  }

  const boundaries: Array<[number, number]> = [];
  let idx = n - 1;
  while (idx >= 0) {
    boundaries.push([parent[idx]!, idx]);
    idx = parent[idx]! - 1;
  }
  boundaries.reverse();

  return boundaries;
}

/**
 * Compute average pairwise cosine similarity for embeddings[start..end].
 * Returns 1.0 for single-element ranges (a segment is perfectly similar to itself).
 */
function avgPairwiseSimilarity(
  embeddings: readonly number[][],
  start: number,
  end: number,
): number {
  if (start === end) return 1.0;

  let total = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    for (let j = i + 1; j <= end; j++) {
      total += cosineSimilarity(embeddings[i]!, embeddings[j]!);
      count++;
    }
  }

  return count === 0 ? 1.0 : total / count;
}
