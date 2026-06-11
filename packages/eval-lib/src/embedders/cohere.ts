import { postJSON } from "../utils/fetch-json.js"
import type { Embedder } from "./embedder.interface.js"
import { assertEmbeddingBatch } from "./embedding-batch.js"

interface CohereEmbedClient {
  embed(opts: {
    model: string
    texts: string[]
    input_type: string
    embedding_types: string[]
  }): Promise<{ embeddings: { float: number[][] } }>
}

const knownDims: Record<string, number> = {
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024
}

export class CohereEmbedder implements Embedder {
  readonly name: string
  readonly dimension: number
  private _model: string
  private _client: CohereEmbedClient

  constructor(options: { client: CohereEmbedClient; model?: string }) {
    this._model = options.model ?? "embed-english-v3.0"
    this._client = options.client
    this.name = `Cohere(${this._model})`
    this.dimension = knownDims[this._model] ?? 1024
  }

  /**
   * Create a CohereEmbedder backed by the Cohere v2 embed REST API.
   * @param options.model - Cohere embedding model (default: "embed-english-v3.0")
   * @param options.apiKey - Cohere API key (defaults to COHERE_API_KEY env var)
   */
  static async create(
    options: { model?: string; apiKey?: string } = {}
  ): Promise<CohereEmbedder> {
    const apiKey = options.apiKey ?? process.env.COHERE_API_KEY
    if (!apiKey) {
      throw new Error(
        "Cohere API key required. Set COHERE_API_KEY environment variable or pass apiKey option."
      )
    }

    const client: CohereEmbedClient = {
      async embed(opts) {
        return postJSON<{ embeddings: { float: number[][] } }>({
          url: "https://api.cohere.com/v2/embed",
          provider: "Cohere",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            texts: opts.texts,
            input_type: opts.input_type,
            embedding_types: opts.embedding_types
          }
        })
      }
    }

    return new CohereEmbedder({ client, model: options.model })
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const response = await this._client.embed({
      model: this._model,
      texts: [...texts],
      input_type: "search_document",
      embedding_types: ["float"]
    })
    const vectors = response.embeddings.float
    assertEmbeddingBatch(vectors, texts.length, this.name)
    return vectors
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await this._client.embed({
      model: this._model,
      texts: [query],
      input_type: "search_query",
      embedding_types: ["float"]
    })
    const vectors = response.embeddings.float
    assertEmbeddingBatch(vectors, 1, this.name)
    return vectors[0]
  }
}
