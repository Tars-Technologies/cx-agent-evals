import type { PositionAwareChunk } from "../types/index.js";
import { postJSON } from "../utils/fetch-json.js";
import type { Reranker } from "./reranker.interface.js";

interface JinaRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    top_n: number;
  }): Promise<{
    results: Array<{ index: number; relevance_score: number }>;
  }>;
}

export class JinaReranker implements Reranker {
  readonly name: string;
  private _model: string;
  private _client: JinaRerankClient;

  constructor(options: { client: JinaRerankClient; model?: string }) {
    this._model = options.model ?? "jina-reranker-v2-base-multilingual";
    this._client = options.client;
    this.name = `Jina(${this._model})`;
  }

  /**
   * Create a JinaReranker using the Jina REST API.
   * @param options.model - Jina reranker model (default: "jina-reranker-v2-base-multilingual")
   * @param options.apiKey - Jina API key (defaults to JINA_API_KEY env var)
   */
  static async create(
    options: { model?: string; apiKey?: string } = {},
  ): Promise<JinaReranker> {
    const apiKey = options.apiKey ?? process.env.JINA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Jina API key required. Set JINA_API_KEY environment variable or pass apiKey option.",
      );
    }

    const model = options.model ?? "jina-reranker-v2-base-multilingual";

    const client: JinaRerankClient = {
      async rerank(opts) {
        return postJSON<{
          results: Array<{ index: number; relevance_score: number }>;
        }>({
          url: "https://api.jina.ai/v1/rerank",
          provider: "Jina Rerank",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            query: opts.query,
            documents: opts.documents,
            top_n: opts.top_n,
          },
        });
      },
    };

    return new JinaReranker({ client, model });
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
      top_n: topK ?? chunks.length,
    });

    return response.results.map((r) => chunks[r.index]);
  }
}
