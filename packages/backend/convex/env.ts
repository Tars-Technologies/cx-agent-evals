import { z } from "zod"

const requiredStr = z
  .string()
  .min(1, "Required environment variable is empty or missing")

const envSchema = z.object({
  OPENAI_API_KEY: requiredStr,
  COHERE_API_KEY: z.string().optional(), // optional — reranker falls back gracefully if not set
  JINA_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  TARSER_BASE_URL: z.string().optional(),
  TARSER_API_TOKEN: z.string().optional(),
  TARSER_CALLBACK_HMAC_SECRET: z.string().optional(),
  TARSER_CALLBACK_BASE_URL: z.string().optional(), // local-dev override for the callback host (e.g. host.docker.internal)
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional()
})

type Env = z.infer<typeof envSchema>

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(envSchema.shape).map((k) => [k, process.env[k]])
  )
}

function parseEnv(): Env {
  const snapshot = snapshotEnv()
  if (process.env.SKIP_ENV_VALIDATION) {
    // Safe in test/CI environments where not all vars are set.
    // Required fields fall back to "" so downstream code fails clearly
    // (e.g. OpenAI auth error) rather than TypeScript lying about undefined.
    const partial = envSchema.partial().parse(snapshot)
    return {
      OPENAI_API_KEY: partial.OPENAI_API_KEY ?? "",
      COHERE_API_KEY: partial.COHERE_API_KEY,
      JINA_API_KEY: partial.JINA_API_KEY,
      VOYAGE_API_KEY: partial.VOYAGE_API_KEY,
      TARSER_BASE_URL: partial.TARSER_BASE_URL,
      TARSER_API_TOKEN: partial.TARSER_API_TOKEN,
      TARSER_CALLBACK_HMAC_SECRET: partial.TARSER_CALLBACK_HMAC_SECRET,
      TARSER_CALLBACK_BASE_URL: partial.TARSER_CALLBACK_BASE_URL,
      QDRANT_URL: partial.QDRANT_URL,
      QDRANT_API_KEY: partial.QDRANT_API_KEY
    }
  }
  const result = envSchema.safeParse(snapshot)
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(
      `\n❌ Missing or invalid environment variables:\n${missing}\n\nSet them via: npx convex env set KEY value\nOr skip with: npx convex env set SKIP_ENV_VALIDATION 1`
    )
  }
  return result.data
}

let cached: Env | null = null
const load = (): Env => (cached ??= parseEnv())

export const env = new Proxy({} as Env, {
  get: (_, prop) => load()[prop as keyof Env],
  ownKeys: () => Reflect.ownKeys(load()),
  getOwnPropertyDescriptor: (_, prop) =>
    Reflect.getOwnPropertyDescriptor(load(), prop)
})
