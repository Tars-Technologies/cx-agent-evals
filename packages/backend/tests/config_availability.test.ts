import { describe, expect, it } from "vitest"

describe("backendConfig.tarser", () => {
  it("is null when TARSER vars are unset", async () => {
    const prev = {
      TARSER_BASE_URL: process.env.TARSER_BASE_URL,
      TARSER_API_TOKEN: process.env.TARSER_API_TOKEN,
      TARSER_CALLBACK_HMAC_SECRET: process.env.TARSER_CALLBACK_HMAC_SECRET,
      SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION
    }
    delete process.env.TARSER_BASE_URL
    delete process.env.TARSER_API_TOKEN
    delete process.env.TARSER_CALLBACK_HMAC_SECRET
    process.env.SKIP_ENV_VALIDATION = "1"
    try {
      const mod = await import("../convex/config")
      expect(mod.isTarserAvailable()).toBe(false)
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})
