import type { PositionAwareChunk } from "../types/index.js"
import { postJSON } from "../utils/fetch-json.js"
import type { Reranker } from "./reranker.interface.js"
import { mapRerankResults } from "./rerank-bounds.js"

interface CohereRerankClient {
  rerank(opts: {
    model: string
    query: string
    documents: string[]
    top_n: number
  }): Promise<{
    results: Array<{ index: number; relevance_score: number }>
  }>
}

export class CohereReranker implements Reranker {
  readonly name: string
  private _model: string
  private _client: CohereRerankClient

  constructor(client: CohereRerankClient, model: string) {
    this._client = client
    this._model = model
    this.name = `Cohere(${this._model})`
  }

  /**
   * Create a CohereReranker backed by the Cohere v2 rerank REST API.
   * @param options.model - Cohere reranker model (default: "rerank-english-v3.0")
   * @param options.apiKey - Cohere API key (defaults to COHERE_API_KEY env var)
   */
  static async create(
    options: { model?: string; apiKey?: string } = {}
  ): Promise<CohereReranker> {
    const apiKey = options.apiKey ?? process.env.COHERE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Cohere API key required. Set COHERE_API_KEY environment variable or pass apiKey option."
      )
    }

    const client: CohereRerankClient = {
      async rerank(opts) {
        return postJSON<{
          results: Array<{ index: number; relevance_score: number }>
        }>({
          url: "https://api.cohere.com/v2/rerank",
          provider: "Cohere Rerank",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            query: opts.query,
            documents: opts.documents,
            top_n: opts.top_n
          }
        })
      }
    }

    return new CohereReranker(client, options.model ?? "rerank-english-v3.0")
  }

  async rerank(
    query: string,
    chunks: readonly PositionAwareChunk[],
    topK?: number
  ): Promise<PositionAwareChunk[]> {
    if (chunks.length === 0) return []

    const response = await this._client.rerank({
      model: this._model,
      query,
      documents: chunks.map((c) => c.content),
      top_n: topK ?? chunks.length
    })

    return mapRerankResults(response.results, chunks, topK)
  }
}
