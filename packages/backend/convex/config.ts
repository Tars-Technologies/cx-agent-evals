import { env } from "./env"

export type BackendConfig = {
  ai: {
    openaiApiKey: string
    cohereApiKey: string | undefined
    jinaApiKey: string | undefined
    voyageApiKey: string | undefined
  }
  tarser: {
    baseUrl: string
    apiToken: string
    hmacSecret: string
  } | null
  qdrant: {
    url: string
    apiKey: string | undefined
  } | null
}

const isNonEmpty = (v: string | undefined): v is string =>
  typeof v === "string" && v.trim().length > 0

function createBackendConfig(): BackendConfig {
  const tarser =
    isNonEmpty(env.TARSER_BASE_URL) &&
    isNonEmpty(env.TARSER_API_TOKEN) &&
    isNonEmpty(env.TARSER_CALLBACK_HMAC_SECRET)
      ? {
          baseUrl: env.TARSER_BASE_URL.trim(),
          apiToken: env.TARSER_API_TOKEN.trim(),
          hmacSecret: env.TARSER_CALLBACK_HMAC_SECRET.trim()
        }
      : null
  const qdrant = isNonEmpty(env.QDRANT_URL)
    ? {
        url: env.QDRANT_URL.trim(),
        apiKey: env.QDRANT_API_KEY?.trim() || undefined
      }
    : null
  return {
    ai: {
      openaiApiKey: env.OPENAI_API_KEY,
      cohereApiKey: env.COHERE_API_KEY,
      jinaApiKey: env.JINA_API_KEY,
      voyageApiKey: env.VOYAGE_API_KEY
    },
    tarser,
    qdrant
  }
}

// Cached on first access. Env var changes via `npx convex env set` require a
// worker restart to take effect. The proxy is lazy at the top level only —
// nested objects (e.g. backendConfig.ai) are plain snapshots captured at load time.
let cached: BackendConfig | null = null
const load = (): BackendConfig => (cached ??= createBackendConfig())

export const backendConfig: BackendConfig = new Proxy({} as BackendConfig, {
  get: (_, prop) => load()[prop as keyof BackendConfig],
  ownKeys: () => Reflect.ownKeys(load()),
  getOwnPropertyDescriptor: (_, prop) =>
    Reflect.getOwnPropertyDescriptor(load(), prop)
})

/** True when all Tarser connection vars are configured. */
export function isTarserAvailable(): boolean {
  return backendConfig.tarser !== null
}
