import { afterEach, describe, expect, it, vi } from "vitest"

// config.ts caches backendConfig on first access, so each case must load a fresh
// module copy with its own env. Snapshot + restore env around every test and
// resetModules so the positive and negative branches are both genuinely exercised
// (not just the degenerate "nothing configured" fixture).
const CONFIG_KEYS = [
  "TARSER_BASE_URL",
  "TARSER_API_TOKEN",
  "TARSER_CALLBACK_HMAC_SECRET",
  "ASIMOV_BASE_URL",
  "ASIMOV_API_TOKEN",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "COHERE_API_KEY",
  "JINA_API_KEY",
  "VOYAGE_API_KEY"
] as const

const saved: Record<string, string | undefined> = {}

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of CONFIG_KEYS) {
    if (saved[k] === undefined && k in process.env) saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.SKIP_ENV_VALIDATION = "1"
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v
  }
  vi.resetModules()
  return import("../convex/config")
}

afterEach(() => {
  for (const k of CONFIG_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("backendConfig.tarser", () => {
  it("is null when TARSER vars are unset", async () => {
    const mod = await setEnv({})
    expect(mod.isTarserAvailable()).toBe(false)
  })

  it("is available only when all three TARSER vars are set", async () => {
    const mod = await setEnv({
      TARSER_BASE_URL: "https://tarser.example.com",
      TARSER_API_TOKEN: "tok",
      TARSER_CALLBACK_HMAC_SECRET: "secret"
    })
    expect(mod.isTarserAvailable()).toBe(true)
  })

  it("is NOT available when the HMAC secret is missing", async () => {
    const mod = await setEnv({
      TARSER_BASE_URL: "https://tarser.example.com",
      TARSER_API_TOKEN: "tok"
    })
    expect(mod.isTarserAvailable()).toBe(false)
  })
})

describe("backendConfig.asimov", () => {
  it("is available with just the base URL (token optional, poll-based)", async () => {
    const mod = await setEnv({ ASIMOV_BASE_URL: "https://asimov.example.com" })
    expect(mod.isAsimovAvailable()).toBe(true)
  })

  it("is null when the base URL is unset", async () => {
    const mod = await setEnv({ ASIMOV_API_TOKEN: "tok" })
    expect(mod.isAsimovAvailable()).toBe(false)
  })
})

describe("providerKeyAvailability", () => {
  it("maps each key to its own provider (catches cross-wired mappings)", async () => {
    // Only Cohere set: a mis-map like `cohere: isNonEmpty(openaiApiKey)` would fail here.
    const mod = await setEnv({ COHERE_API_KEY: "ck" })
    expect(mod.providerKeyAvailability()).toEqual({
      openai: false,
      openrouter: false,
      cohere: true,
      jina: false,
      voyage: false
    })
  })

  it("reflects multiple configured providers independently", async () => {
    const mod = await setEnv({ OPENAI_API_KEY: "ok", VOYAGE_API_KEY: "vk" })
    expect(mod.providerKeyAvailability()).toEqual({
      openai: true,
      openrouter: false,
      cohere: false,
      jina: false,
      voyage: true
    })
  })
})
