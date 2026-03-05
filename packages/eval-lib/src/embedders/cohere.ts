import type { Embedder } from "./embedder.interface.js";

interface CohereEmbedClient {
  embed(opts: {
    model: string;
    texts: string[];
    inputType: string;
    embeddingTypes: string[];
  }): Promise<{
    embeddings: { float: number[][] };
  }>;
}

const knownDims: Record<string, number> = {
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
};

export class CohereEmbedder implements Embedder {
  readonly name: string;
  readonly dimension: number;
  private _model: string;
  private _client: CohereEmbedClient;

  constructor(options: { client: CohereEmbedClient; model?: string }) {
    this._model = options.model ?? "embed-english-v3.0";
    this._client = options.client;
    this.name = `Cohere(${this._model})`;
    this.dimension = knownDims[this._model] ?? 1024;
  }

  static async create(
    options: { model?: string; apiKey?: string } = {},
  ): Promise<CohereEmbedder> {
    try {
      const { CohereClient } = await import("cohere-ai");
      const client = new CohereClient({ token: options.apiKey });
      return new CohereEmbedder({
        client: client as CohereEmbedClient,
        model: options.model,
      });
    } catch {
      throw new Error(
        "cohere-ai package required. Install with: pnpm add cohere-ai",
      );
    }
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const response = await this._client.embed({
      model: this._model,
      texts: [...texts],
      inputType: "search_document",
      embeddingTypes: ["float"],
    });
    return response.embeddings.float;
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await this._client.embed({
      model: this._model,
      texts: [query],
      inputType: "search_query",
      embeddingTypes: ["float"],
    });
    return response.embeddings.float[0];
  }
}
