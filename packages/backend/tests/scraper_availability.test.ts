import { beforeAll, describe, expect, it } from "vitest"
import { api } from "../convex/_generated/api"
import { setupTest, testIdentity } from "./helpers"

// providers.ts reads backendConfig -> env; set skip flag so env.ts doesn't
// throw on missing OPENAI_API_KEY in the test environment.
beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
  delete process.env.TARSER_BASE_URL
  delete process.env.TARSER_API_TOKEN
  delete process.env.TARSER_CALLBACK_HMAC_SECRET
})

describe("getScraperAvailability", () => {
  it("reports tarser:false when unconfigured", async () => {
    const t = setupTest()
    const out = await t.withIdentity(testIdentity).query(api.kb.providers.getScraperAvailability, {})
    expect(out).toEqual({ tarser: false })
  })
})
