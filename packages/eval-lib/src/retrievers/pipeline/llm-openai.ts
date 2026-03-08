import type { PipelineLLM } from "./llm.interface.js";

/**
 * Structural typing — duck-typed against exactly the OpenAI surface area we use.
 * Follows the same pattern as OpenAIEmbedder and CohereReranker.
 */
interface OpenAIChatClient {
  chat: {
    completions: {
      create(opts: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

export class OpenAIPipelineLLM implements PipelineLLM {
  readonly name: string;

  private readonly _client: OpenAIChatClient;
  private readonly _model: string;
  private readonly _temperature: number;

  constructor(
    client: OpenAIChatClient,
    options?: { model?: string; temperature?: number },
  ) {
    this._client = client;
    this._model = options?.model ?? "gpt-4o-mini";
    this._temperature = options?.temperature ?? 0.2;
    this.name = `OpenAI(${this._model})`;
  }

  /**
   * Convenience factory that creates an OpenAI client from an API key.
   * Dynamically imports the `openai` package to keep it optional.
   */
  static async create(options?: {
    model?: string;
    temperature?: number;
    apiKey?: string;
  }): Promise<OpenAIPipelineLLM> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: options?.apiKey });
    // Cast needed: OpenAI SDK types are stricter than our structural interface,
    // but the runtime shapes are compatible for the subset we use.
    return new OpenAIPipelineLLM(client as unknown as OpenAIChatClient, options);
  }

  async complete(prompt: string): Promise<string> {
    const response = await this._client.chat.completions.create({
      model: this._model,
      messages: [{ role: "user", content: prompt }],
      temperature: this._temperature,
    });
    return response.choices[0]?.message.content ?? "";
  }
}
