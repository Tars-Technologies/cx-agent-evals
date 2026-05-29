import { env } from "./env"

export type BackendConfig = {
  ai: {
    openaiApiKey: string
    cohereApiKey: string | undefined
  }
}

function createBackendConfig(): BackendConfig {
  return {
    ai: {
      openaiApiKey: env.OPENAI_API_KEY,
      cohereApiKey: env.COHERE_API_KEY
    }
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
