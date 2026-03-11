import { postJSON } from "../utils/fetch-json.js";
import type { Embedder } from "./embedder.interface.js";

interface JinaEmbedClient {
  embed(opts: {
    model: string;
    input: string[];
    task: string;
    dimensions?: number;
  }): Promise<{
    data: Array<{ embedding: number[]; index: number }>;
  }>;
}

export class JinaEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;
  private _model: string;
  private _dimensions: number;
  private _client: JinaEmbedClient;

  constructor(options: {
    client: JinaEmbedClient;
    model?: string;
    dimensions?: number;
  }) {
    this._model = options.model ?? "jina-embeddings-v3";
    this._dimensions = options.dimensions ?? 1024;
    this._client = options.client;
    this.name = `Jina(${this._model})`;
    this.dimension = this._dimensions;
  }

  static async create(
    options: { model?: string; apiKey?: string; dimensions?: number } = {},
  ): Promise<JinaEmbedder> {
    const apiKey = options.apiKey ?? process.env.JINA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Jina API key required. Set JINA_API_KEY environment variable or pass apiKey option.",
      );
    }

    const model = options.model ?? "jina-embeddings-v3";
    const dimensions = options.dimensions ?? 1024;

    const client: JinaEmbedClient = {
      async embed(opts) {
        return postJSON<{
          data: Array<{ embedding: number[]; index: number }>;
        }>({
          url: "https://api.jina.ai/v1/embeddings",
          provider: "Jina",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            input: opts.input,
            task: opts.task,
            dimensions: opts.dimensions,
          },
        });
      },
    };

    return new JinaEmbedder({ client, model, dimensions });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const response = await this._client.embed({
      model: this._model,
      input: [...texts],
      task: "retrieval.passage",
      dimensions: this._dimensions,
    });
    return response.data.map((d) => d.embedding);
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await this._client.embed({
      model: this._model,
      input: [query],
      task: "retrieval.query",
      dimensions: this._dimensions,
    });
    return response.data[0].embedding;
  }
}
