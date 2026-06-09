import type { BackendConfig } from "../config"

export interface RerankerSelection {
  provider: "cohere" | "jina" | "voyage"
  model?: string
  apiKey: string
}

/**
 * Resolve which reranker to build from a retriever's refinement steps.
 *
 * Reads `provider` (default "cohere") and `model` off the first rerank step,
 * selects the API key by provider, and returns undefined when there is no
 * rerank step, the provider is unknown, or the selected provider's key is not
 * configured (graceful skip - preserves the prior "no reranker when
 * unavailable" behavior so existing experiments do not change).
 */
export function resolveRerankerSelection(
  refinementSteps: ReadonlyArray<Record<string, unknown>>,
  ai: BackendConfig["ai"]
): RerankerSelection | undefined {
  const rerankStep = refinementSteps.find((s) => s.type === "rerank")
  if (!rerankStep) return undefined

  const provider = (rerankStep.provider as string) ?? "cohere"
  if (provider !== "cohere" && provider !== "jina" && provider !== "voyage") {
    return undefined
  }

  const keyByProvider: Record<typeof provider, string | undefined> = {
    cohere: ai.cohereApiKey,
    jina: ai.jinaApiKey,
    voyage: ai.voyageApiKey
  }
  const apiKey = keyByProvider[provider]
  if (!apiKey) return undefined

  return {
    provider,
    model: rerankStep.model as string | undefined,
    apiKey
  }
}
