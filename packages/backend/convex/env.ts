import { z } from "zod"

const requiredStr = z
  .string()
  .min(1, "Required environment variable is empty or missing")

const envSchema = z.object({
  OPENAI_API_KEY: requiredStr,
  COHERE_API_KEY: z.string().optional() // optional — reranker falls back gracefully if not set
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
      COHERE_API_KEY: partial.COHERE_API_KEY
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
