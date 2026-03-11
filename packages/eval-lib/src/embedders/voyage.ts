import { postJSON } from "../utils/fetch-json.js";
import type { Embedder } from "./embedder.interface.js";

interface VoyageEmbedClient {
  embed(opts: {
    model: string;
    input: string[];
    input_type: string;
  }): Promise<{
    data: Array<{ embedding: number[]; index: number }>;
  }>;
}

const knownDims: Record<string, number> = {
  "voyage-3.5": 1024,
  "voyage-3.5-lite": 512,
  "voyage-3": 1024,
  "voyage-code-3": 1024,
};

export class VoyageEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;
  private _model: string;
  private _client: VoyageEmbedClient;

  constructor(options: { client: VoyageEmbedClient; model?: string }) {
    this._model = options.model ?? "voyage-3.5";
    this._client = options.client;
    this.name = `Voyage(${this._model})`;
    this.dimension = knownDims[this._model] ?? 1024;
  }

  static async create(
    options: { model?: string; apiKey?: string } = {},
  ): Promise<VoyageEmbedder> {
    const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Voyage API key required. Set VOYAGE_API_KEY environment variable or pass apiKey option.",
      );
    }

    const model = options.model ?? "voyage-3.5";

    const client: VoyageEmbedClient = {
      async embed(opts) {
        return postJSON<{
          data: Array<{ embedding: number[]; index: number }>;
        }>({
          url: "https://api.voyageai.com/v1/embeddings",
          provider: "Voyage",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: opts.model,
            input: opts.input,
            input_type: opts.input_type,
          },
        });
      },
    };

    return new VoyageEmbedder({ client, model });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const response = await this._client.embed({
      model: this._model,
      input: [...texts],
      input_type: "document",
    });
    return response.data.map((d) => d.embedding);
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await this._client.embed({
      model: this._model,
      input: [query],
      input_type: "query",
    });
    return response.data[0].embedding;
  }
}
