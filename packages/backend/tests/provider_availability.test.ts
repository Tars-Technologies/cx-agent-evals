import { beforeAll, describe, expect, it } from "vitest"
import { api } from "../convex/_generated/api"
import { setupTest, testIdentity } from "./helpers"

// providers.ts reads backendConfig -> env; set skip flag so env.ts doesn't
// throw on missing OPENAI_API_KEY in the test environment.
beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.COHERE_API_KEY
  delete process.env.JINA_API_KEY
  delete process.env.VOYAGE_API_KEY
})

describe("getProviderAvailability", () => {
  it("reports every provider false when no keys are configured", async () => {
    const t = setupTest()
    const out = await t
      .withIdentity(testIdentity)
      .query(api.kb.providers.getProviderAvailability, {})
    expect(out).toEqual({
      openai: false,
      openrouter: false,
      cohere: false,
      jina: false,
      voyage: false
    })
  })
})
