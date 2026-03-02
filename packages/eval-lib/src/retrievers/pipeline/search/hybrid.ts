import type { PositionAwareChunk } from "../../../types/chunks.js";
import type { ScoredChunk } from "../types.js";
import type { SearchStrategy, SearchStrategyDeps } from "./strategy.interface.js";
import { DenseSearchStrategy } from "./dense.js";
import { BM25SearchStrategy } from "./bm25.js";
import { weightedScoreFusion, reciprocalRankFusion } from "./fusion.js";

/**
 * Hybrid search strategy that combines dense (vector) and BM25 (keyword)
 * retrieval, fusing results via weighted score combination or reciprocal
 * rank fusion.
 */
export class HybridSearchStrategy implements SearchStrategy {
  readonly name = "hybrid";

  private readonly _dense: DenseSearchStrategy;
  private readonly _bm25: BM25SearchStrategy;
  private readonly _fusionMethod: "weighted" | "rrf";
  private readonly _denseWeight: number;
  private readonly _sparseWeight: number;
  private readonly _candidateMultiplier: number;
  private readonly _rrfK: number | undefined;

  constructor(options?: {
    readonly batchSize?: number;
    readonly k1?: number;
    readonly b?: number;
    readonly fusionMethod?: "weighted" | "rrf";
    readonly denseWeight?: number;
    readonly sparseWeight?: number;
    readonly candidateMultiplier?: number;
    readonly rrfK?: number;
  }) {
    this._dense = new DenseSearchStrategy({ batchSize: options?.batchSize });
    this._bm25 = new BM25SearchStrategy({ k1: options?.k1, b: options?.b });
    this._fusionMethod = options?.fusionMethod ?? "weighted";
    this._denseWeight = options?.denseWeight ?? 0.7;
    this._sparseWeight = options?.sparseWeight ?? 0.3;
    this._candidateMultiplier = options?.candidateMultiplier ?? 4;
    this._rrfK = options?.rrfK;
  }

  async init(chunks: readonly PositionAwareChunk[], deps: SearchStrategyDeps): Promise<void> {
    await this._dense.init(chunks, deps);
    await this._bm25.init(chunks, deps);
  }

  async search(query: string, k: number, deps: SearchStrategyDeps): Promise<ScoredChunk[]> {
    const candidateK = k * this._candidateMultiplier;

    // Run dense + BM25 in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this._dense.search(query, candidateK, deps),
      this._bm25.search(query, candidateK, deps),
    ]);

    if (this._fusionMethod === "rrf") {
      return reciprocalRankFusion({
        denseResults,
        sparseResults,
        k: this._rrfK,
      });
    }

    return weightedScoreFusion({
      denseResults,
      sparseResults,
      denseWeight: this._denseWeight,
      sparseWeight: this._sparseWeight,
    });
  }

  async cleanup(deps: SearchStrategyDeps): Promise<void> {
    // Dense cleanup is a no-op (vector store owned by PipelineRetriever).
    // BM25 cleanup releases the inverted index.
    await this._dense.cleanup(deps);
    await this._bm25.cleanup(deps);
  }
}
