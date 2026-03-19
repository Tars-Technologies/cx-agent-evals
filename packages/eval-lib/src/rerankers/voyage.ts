import type { PositionAwareChunk } from "../types/index.js";
import { postJSON } from "../utils/fetch-json.js";
import type { Reranker } from "./reranker.interface.js";

interface VoyageRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    top_k: number;
  }): Promise<{
    data: Array<{ index: number; relevance_score: number }>;
  }>;
}

export class VoyageReranker implements Reranker {
  readonly name: string;
  private _model: string;
  private _client: VoyageRerankClient;

  constructor(options: { client: VoyageRerankClient; model?: string }) {
    this._model = options.model ?? "rerank-2.5";
    this._client = options.client;
    this.name = `Voyage(${this._model})`;
  }

  /**
   * Create a VoyageReranker using the Voyage REST API.
   * @param options.model - Voyage reranker model (default: "rerank-2.5")
   * @param options.apiKey - Voyage API key (defaults to VOYAGE_API_KEY env var)
   */
  static async create(
    options: { model?: string; apiKey?: string } = {},
  ): Promise<VoyageReranker> {
    const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Voyage API key required. Set VOYAGE_API_KEY environment variable or pass apiKey option.",
      );
    }

    const model = options.model ?? "rerank-2.5";

    const client: VoyageRerankClient = {
      async rerank(opts) {
        return postJSON<{
          data: Array<{ index: number; relevance_score: number }>;
        }>({
          url: "https://api.voyageai.com/v1/rerank",
          provider: "Voyage Rerank",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            query: opts.query,
            documents: opts.documents,
            top_k: opts.top_k,
          },
        });
      },
    };

    return new VoyageReranker({ client, model });
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
      top_k: topK ?? chunks.length,
    });

    return response.data.map((r) => chunks[r.index]);
  }
}
