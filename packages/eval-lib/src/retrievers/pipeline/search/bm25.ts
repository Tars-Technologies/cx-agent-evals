import MiniSearch from "minisearch";
import type { PositionAwareChunk } from "../../../types/index.js";
import type { ScoredChunk } from "../types.js";
import type { SearchStrategy, SearchStrategyDeps } from "./strategy.interface.js";

/**
 * Default BM25+ delta parameter — the additive frequency normalization
 * lower bound introduced by BM25+.  A value of 0 reduces to classic BM25;
 * higher values boost the contribution of terms that appear at least once,
 * preventing near-zero term-frequency scores for long documents.
 * Typical range: 0.0 -- 1.0.  The original BM25+ paper recommends 0.5.
 */
const DEFAULT_BM25_DELTA = 0.5;

/**
 * BM25 full-text search index backed by MiniSearch.
 *
 * Indexes `PositionAwareChunk` documents on their `content` field and
 * supports top-k retrieval with optional normalized relevance scores.
 */
export class BM25SearchIndex {
  private readonly _k1: number;
  private readonly _b: number;
  private _index: MiniSearch | null = null;
  private _chunkMap: Map<string, PositionAwareChunk> = new Map();

  /**
   * @param options.k1 - Term-frequency saturation parameter (default 1.2).
   *   Higher values increase the influence of term frequency; lower values
   *   make the score less sensitive to how often a term appears in a chunk.
   *   Typical range: 1.2 -- 2.0.
   * @param options.b  - Document-length normalization (default 0.75, range 0 -- 1).
   *   At 0, document length is ignored; at 1, term frequency is fully
   *   normalized by document length.  Reduce for corpora where longer
   *   chunks are inherently more relevant.
   */
  constructor(options?: { readonly k1?: number; readonly b?: number }) {
    this._k1 = options?.k1 ?? 1.2;
    this._b = options?.b ?? 0.75;
  }

  /**
   * Build the search index from a collection of position-aware chunks.
   * Replaces any previously built index.
   */
  build(chunks: readonly PositionAwareChunk[]): void {
    this._chunkMap = new Map<string, PositionAwareChunk>();

    this._index = new MiniSearch({
      fields: ["content"],
      storeFields: ["content"],
      idField: "id",
    });

    const documents: Array<{ id: string; content: string }> = [];

    for (const chunk of chunks) {
      const id = chunk.id as string;
      this._chunkMap.set(id, chunk);
      documents.push({ id, content: chunk.content });
    }

    this._index.addAll(documents);
  }

  /**
   * Search the index and return the top `k` matching chunks.
   */
  search(query: string, k: number): readonly PositionAwareChunk[] {
    return this.searchWithScores(query, k).map(({ chunk }) => chunk);
  }

  /**
   * Search the index and return the top `k` matching chunks with
   * normalized scores in the range [0, 1]. The highest-scoring result
   * always receives a score of 1.0.
   */
  searchWithScores(query: string, k: number): readonly ScoredChunk[] {
    if (this._index === null) {
      return [];
    }

    const raw = this._index.search(query, {
      boost: { content: 1 },
      bm25: { k: this._k1, b: this._b, d: DEFAULT_BM25_DELTA },
    });

    if (raw.length === 0) {
      return [];
    }

    const topResults = raw.slice(0, k);
    const maxScore = topResults[0].score;

    const toScoredChunk = (
      result: { id: string; score: number },
      normalizer: number,
    ): ScoredChunk | undefined => {
      const chunk = this._chunkMap.get(result.id);
      if (chunk === undefined) {
        return undefined;
      }
      return { chunk, score: normalizer === 0 ? 0 : result.score / normalizer };
    };

    const results: ScoredChunk[] = [];
    for (const result of topResults) {
      const scored = toScoredChunk(
        { id: String(result.id), score: result.score },
        maxScore,
      );
      if (scored !== undefined) {
        results.push(scored);
      }
    }

    return results;
  }

  /**
   * Clear the index and release all stored chunks.
   */
  clear(): void {
    this._index = null;
    this._chunkMap = new Map();
  }
}

// ---------------------------------------------------------------------------
// BM25 Search Strategy (wraps BM25SearchIndex)
// ---------------------------------------------------------------------------

/**
 * Strategy-pattern wrapper around {@link BM25SearchIndex}.
 *
 * Builds a BM25 inverted index during `init` and performs keyword-based
 * retrieval during `search`.  The vector store and embedder are not used.
 */
export class BM25SearchStrategy implements SearchStrategy {
  readonly name = "bm25";

  private _index: BM25SearchIndex | null = null;
  private readonly _k1: number | undefined;
  private readonly _b: number | undefined;

  constructor(options?: { readonly k1?: number; readonly b?: number }) {
    this._k1 = options?.k1;
    this._b = options?.b;
  }

  async init(chunks: readonly PositionAwareChunk[], _deps: SearchStrategyDeps): Promise<void> {
    const bm25Config = { k1: this._k1, b: this._b };
    this._index = new BM25SearchIndex(bm25Config);
    this._index.build(chunks);
  }

  async search(query: string, k: number, _deps: SearchStrategyDeps): Promise<ScoredChunk[]> {
    if (!this._index) {
      return [];
    }
    return [...this._index.searchWithScores(query, k)];
  }

  async cleanup(_deps: SearchStrategyDeps): Promise<void> {
    if (this._index) {
      this._index.clear();
      this._index = null;
    }
  }
}
