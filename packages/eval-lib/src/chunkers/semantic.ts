import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import { RecursiveCharacterChunker } from "./recursive-character.js";
import { cosineSimilarity } from "../utils/similarity.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface SemanticChunkerOptions {
  /** Percentile threshold for split detection. @default 95 */
  readonly percentileThreshold?: number;
  /** Maximum chunk size in characters. Chunks exceeding this are sub-split. @default 2000 */
  readonly maxChunkSize?: number;
}

interface Sentence {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Semantic chunker (Kamradt method): splits text into sentences, embeds them,
 * detects topic shifts via cosine similarity drops between consecutive
 * sentence embeddings, and splits at those boundaries.
 *
 * Chunks that exceed `maxChunkSize` are further sub-split using
 * RecursiveCharacterChunker to guarantee a hard size limit.
 */
export class SemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string;
  readonly async = true as const;

  private readonly _embedder: Embedder;
  private readonly _percentileThreshold: number;
  private readonly _maxChunkSize: number;

  constructor(embedder: Embedder, options?: SemanticChunkerOptions) {
    this._embedder = embedder;
    this._percentileThreshold = options?.percentileThreshold ?? 95;
    this._maxChunkSize = options?.maxChunkSize ?? 2000;
    this.name = `Semantic(threshold=${this._percentileThreshold})`;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const sentences = splitSentences(doc.content);
    if (sentences.length === 0) return [];

    if (sentences.length === 1) {
      return this._buildChunks(doc, [sentences]);
    }

    const embeddings = await this._embedder.embed(
      sentences.map((s) => s.text),
    );

    const similarities = computeConsecutiveSimilarities(embeddings);
    const threshold = percentile(similarities, this._percentileThreshold);
    const groups = groupSentencesBySimilarity(sentences, similarities, threshold);

    return this._buildChunks(doc, groups);
  }

  private _buildChunks(
    doc: Document,
    groups: readonly Sentence[][],
  ): PositionAwareChunk[] {
    const chunks: PositionAwareChunk[] = [];
    const subSplitter = new RecursiveCharacterChunker({
      chunkSize: this._maxChunkSize,
      chunkOverlap: 0,
    });

    for (const group of groups) {
      if (group.length === 0) continue;

      const start = group[0]!.start;
      const end = group[group.length - 1]!.end;
      const content = doc.content.slice(start, end);

      if (content.length <= this._maxChunkSize) {
        chunks.push({
          id: generatePaChunkId(content, String(doc.id), start),
          content,
          docId: doc.id,
          start,
          end,
          metadata: {},
        });
      } else {
        const subDoc: Document = { ...doc, content };
        const subChunks = subSplitter.chunkWithPositions(subDoc);
        for (const sub of subChunks) {
          chunks.push({
            ...sub,
            id: generatePaChunkId(sub.content, String(doc.id), start + sub.start),
            docId: doc.id,
            start: start + sub.start,
            end: start + sub.end,
          });
        }
      }
    }

    return chunks;
  }
}

/** Split text into sentences using punctuation + capital-letter boundaries. */
function splitSentences(text: string): Sentence[] {
  if (text.trim().length === 0) return [];

  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const result: Sentence[] = [];
  let searchFrom = 0;

  for (const part of parts) {
    if (part.trim().length === 0) continue;
    const idx = text.indexOf(part, searchFrom);
    if (idx === -1) continue;
    result.push({ text: part, start: idx, end: idx + part.length });
    searchFrom = idx + part.length;
  }

  return result;
}

/** Compute cosine similarity between each pair of consecutive embeddings. */
function computeConsecutiveSimilarities(
  embeddings: readonly number[][],
): number[] {
  const similarities: number[] = [];
  for (let i = 0; i < embeddings.length - 1; i++) {
    similarities.push(cosineSimilarity(embeddings[i]!, embeddings[i + 1]!));
  }
  return similarities;
}

/**
 * Group sentences into clusters, splitting wherever similarity drops
 * below the threshold. Lower similarity = bigger topic shift.
 */
function groupSentencesBySimilarity(
  sentences: readonly Sentence[],
  similarities: readonly number[],
  threshold: number,
): Sentence[][] {
  const groups: Sentence[][] = [];
  let currentGroup: Sentence[] = [sentences[0]!];

  for (let i = 0; i < similarities.length; i++) {
    if (similarities[i]! < threshold) {
      groups.push(currentGroup);
      currentGroup = [sentences[i + 1]!];
    } else {
      currentGroup.push(sentences[i + 1]!);
    }
  }
  groups.push(currentGroup);

  return groups;
}

/** Compute the p-th percentile of a numeric array using linear interpolation. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (idx - lower);
}
