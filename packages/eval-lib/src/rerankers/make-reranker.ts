import { CohereReranker } from "./cohere.js"
import { JinaReranker } from "./jina.js"
import type { Reranker } from "./reranker.interface.js"
import { VoyageReranker } from "./voyage.js"

export type RerankerProvider = "cohere" | "jina" | "voyage"

export interface RerankerConfig {
  /** Reranker provider. Defaults to "cohere". */
  provider?: RerankerProvider
  /** Provider-specific model id. Falls back to the provider's default. */
  model?: string
  /** API key. Falls back to the provider's env var. */
  apiKey?: string
}

/** Build a Reranker for the selected provider (cohere default, jina, voyage). */
export async function makeReranker(
  config: RerankerConfig = {}
): Promise<Reranker> {
  const provider = config.provider ?? "cohere"
  switch (provider) {
    case "cohere":
      return CohereReranker.create({
        model: config.model,
        apiKey: config.apiKey
      })
    case "jina":
      return JinaReranker.create({ model: config.model, apiKey: config.apiKey })
    case "voyage":
      return VoyageReranker.create({
        model: config.model,
        apiKey: config.apiKey
      })
    default:
      throw new Error(`Unknown reranker provider: ${provider}`)
  }
}
