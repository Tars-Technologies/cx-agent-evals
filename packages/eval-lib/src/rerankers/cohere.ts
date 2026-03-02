import type { PositionAwareChunk } from "../types/index.js";
import type { Reranker } from "./reranker.interface.js";

interface CohereRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    topN: number;
  }): Promise<{
    results: Array<{ index: number; relevanceScore: number }>;
  }>;
}

export class CohereReranker implements Reranker {
  readonly name: string;
  private _model: string;
  private _client: CohereRerankClient;

  private constructor(client: CohereRerankClient, model: string) {
    this._client = client;
    this._model = model;
    this.name = `Cohere(${this._model})`;
  }

  static async create(
    options: { model?: string } = {},
  ): Promise<CohereReranker> {
    try {
      const { CohereClient } = await import("cohere-ai");
      const client = new CohereClient();
      return new CohereReranker(client, options.model ?? "rerank-english-v3.0");
    } catch {
      throw new Error("cohere-ai package required. Install with: pnpm add cohere-ai");
    }
  }

  async rerank(
    query: string,
    chunks: readonly PositionAwareChunk[],
    topK?: number,
  ): Promise<PositionAwareChunk[]> {
    if (chunks.length === 0) return [];

    const response = await this._client.rerank({
      model: this._model,
      query,
      documents: chunks.map((c) => c.content),
      topN: topK ?? chunks.length,
    });

    return response.results.map((r) => chunks[r.index]);
  }
}
