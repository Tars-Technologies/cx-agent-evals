import { CohereEmbedder } from "./cohere.js"
import type { Embedder } from "./embedder.interface.js"
import { OpenAIEmbedder } from "./openai.js"

export type EmbedderProvider = "openai" | "openrouter" | "cohere"

export interface EmbedderConfig {
  /** Embedding provider. Defaults to "openai". */
  provider?: EmbedderProvider
  /** Provider-specific model id. Falls back to the provider's default. */
  model?: string
  /** API key. Falls back to the provider's env var. */
  apiKey?: string
}

/**
 * Build an Embedder for the selected provider.
 *
 * - openai (default): OpenAIEmbedder using OPENAI_API_KEY.
 * - openrouter: OpenAIEmbedder pointed at the OpenRouter base URL (OPENROUTER_API_KEY).
 * - cohere: CohereEmbedder over the Cohere v2 HTTP API (COHERE_API_KEY).
 */
export async function makeEmbedder(
  config: EmbedderConfig = {}
): Promise<Embedder> {
  const provider = config.provider ?? "openai"

  switch (provider) {
    case "openai": {
      const { default: OpenAI } = await import("openai")
      const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error("OPENAI_API_KEY not set")
      return new OpenAIEmbedder({
        model: config.model,
        client: new OpenAI({ apiKey })
      })
    }
    case "openrouter": {
      const { default: OpenAI } = await import("openai")
      const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new Error("OPENROUTER_API_KEY not set")
      return new OpenAIEmbedder({
        model: config.model,
        client: new OpenAI({
          apiKey,
          baseURL: "https://openrouter.ai/api/v1"
        })
      })
    }
    case "cohere":
      return CohereEmbedder.create({
        model: config.model,
        apiKey: config.apiKey
      })
    default:
      throw new Error(`Unknown embedder provider: ${provider}`)
  }
}
