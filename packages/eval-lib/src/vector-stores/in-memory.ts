import type { PositionAwareChunk } from "../types/index.js";
import type { VectorStore, VectorSearchResult } from "./vector-store.interface.js";
import { cosineSimilarity } from "../utils/similarity.js";

export class InMemoryVectorStore implements VectorStore {
  readonly name = "InMemory";
  private _chunks: PositionAwareChunk[] = [];
  private _embeddings: number[][] = [];

  async add(
    chunks: readonly PositionAwareChunk[],
    embeddings: readonly number[][],
  ): Promise<void> {
    if (this._chunks.length > 0) {
      console.warn(
        `[InMemoryVectorStore] add() called while store already contains ${this._chunks.length} chunks — clearing existing state to avoid duplicates`,
      );
      this._chunks = [];
      this._embeddings = [];
    }
    this._chunks.push(...chunks);
    this._embeddings.push(...embeddings.map((e) => [...e]));
  }

  async search(
    queryEmbedding: readonly number[],
    k: number = 5,
  ): Promise<VectorSearchResult[]> {
    const scored = this._chunks.map((chunk, i) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, this._embeddings[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  async clear(): Promise<void> {
    this._chunks = [];
    this._embeddings = [];
  }
}
