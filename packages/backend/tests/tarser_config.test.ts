import { describe, expect, it } from "vitest"

describe("backendConfig.tarser", () => {
  it("is null when TARSER vars are unset", async () => {
    delete process.env.TARSER_BASE_URL
    delete process.env.TARSER_API_TOKEN
    delete process.env.TARSER_CALLBACK_HMAC_SECRET
    process.env.SKIP_ENV_VALIDATION = "1"
    const mod = await import("../convex/config")
    expect(mod.isTarserAvailable()).toBe(false)
  })
})
