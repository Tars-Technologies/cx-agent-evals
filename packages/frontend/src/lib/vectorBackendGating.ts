import type { RegistryEntry } from "@tars-inc/eval-lib/registry"

export type VectorBackendChoice = "native" | "qdrant"

export const VECTOR_BACKEND_CHOICES: ReadonlyArray<{
  id: VectorBackendChoice
  name: string
  description: string
}> = [
  {
    id: "native",
    name: "Convex (built-in)",
    description:
      "Vectors live in Convex's built-in 1536-dimension index. Zero setup; OpenAI text-embedding-3-small only."
  },
  {
    id: "qdrant",
    name: "Qdrant",
    description:
      "Vectors live in an external Qdrant collection (any dimension, any embedder). Requires QDRANT_URL on the backend."
  }
]

/**
 * Whether a provider's API key is configured on the backend. `availability` is
 * the map from `getProviderAvailability`; while it is still loading (undefined)
 * we treat every provider as configured so options aren't briefly disabled.
 */
export function isProviderKeyConfigured(
  providerId: string,
  availability: Record<string, boolean> | undefined
): boolean {
  if (!availability) return true
  return availability[providerId] !== false
}

/** Native is hard-locked to OpenAI 1536-dim embeddings (Convex vector index). */
export function isEmbedderAllowed(
  entry: RegistryEntry,
  backend: VectorBackendChoice
): boolean {
  if (entry.status !== "available") return false
  if (backend === "qdrant") return true
  return entry.id === "openai"
}

/**
 * For native, narrow an embedder entry's model choices to 1536-dim models.
 * Returns the entry untouched for qdrant.
 */
export function gateEmbedderEntry(
  entry: RegistryEntry,
  backend: VectorBackendChoice
): RegistryEntry {
  if (backend === "qdrant") return entry
  return {
    ...entry,
    options: entry.options.map((opt) =>
      opt.key === "model" && opt.choices
        ? { ...opt, choices: opt.choices.filter((c) => c.dimensions === 1536) }
        : opt
    )
  }
}
