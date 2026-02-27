import type { PositionAwareChunk } from "../../../types/chunks.js";
import type { ScoredChunk } from "../types.js";
import type { SearchStrategy, SearchStrategyDeps } from "./strategy.interface.js";

/**
 * Dense (embedding-based) vector search strategy.
 *
 * During init the chunks are embedded in batches and stored in the vector
 * store. At search time the query is embedded and a nearest-neighbour lookup
 * is performed.
 */
export class DenseSearchStrategy implements SearchStrategy {
  readonly name = "dense";

  private readonly _batchSize: number;

  constructor(options?: { readonly batchSize?: number }) {
    this._batchSize = options?.batchSize ?? 100;
  }

  async init(chunks: readonly PositionAwareChunk[], deps: SearchStrategyDeps): Promise<void> {
    const { embedder, vectorStore } = deps;

    for (let i = 0; i < chunks.length; i += this._batchSize) {
      const batch = chunks.slice(i, i + this._batchSize);
      const embeddings = await embedder.embed(batch.map((c) => c.content));
      await vectorStore.add(batch, embeddings);
    }
  }

  async search(query: string, k: number, deps: SearchStrategyDeps): Promise<ScoredChunk[]> {
    const { embedder, vectorStore } = deps;

    const queryEmbedding = await embedder.embedQuery(query);
    const chunks = await vectorStore.search(queryEmbedding, k);

    // VectorStore returns chunks sorted by similarity but without scores.
    // Assign linearly decaying scores for rank-based normalization.
    return assignRankScores(chunks);
  }

  async cleanup(_deps: SearchStrategyDeps): Promise<void> {
    // Dense strategy stores data in the shared vector store which is owned
    // by the PipelineRetriever — nothing strategy-local to clean up.
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Assigns linearly decaying scores based on position.
 * First result gets 1.0, last gets 1/count.
 */
export function assignRankScores(chunks: readonly PositionAwareChunk[]): ScoredChunk[] {
  const count = chunks.length;
  if (count === 0) return [];
  return chunks.map((chunk, i) => ({
    chunk,
    score: (count - i) / count,
  }));
}
