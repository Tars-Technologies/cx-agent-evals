import { describe, expect, it } from "vitest"
import { api } from "../convex/_generated/api"
import { seedUser, setupTest, testIdentity } from "./helpers"

// NOTE: startCrawl only normalizes the scheme and rejects non-http(s) URLs. It does
// NOT block private/metadata hosts — that SSRF guard (assertHostResolvesPublic +
// isBlockedHost, incl. DNS-rebinding) runs downstream at fetch/submit time and is
// covered in eval-lib's scraper/url-guard tests. These tests cover ONLY the
// entrypoint's scheme + bare-domain normalization, so they assert unconditionally.
describe("startCrawl URL normalization", () => {
  it("rejects a non-http(s) scheme up front", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)
    const kbId = await authedT.mutation(api.kb.core.create, { name: "Test KB" })
    await expect(
      authedT.mutation(api.kb.crawl.startCrawl, {
        kbId,
        startUrl: "file:///etc/passwd"
      })
    ).rejects.toThrow()
  })

  it("normalizes a bare domain to https://", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)
    const kbId = await authedT.mutation(api.kb.core.create, { name: "Test KB" })
    const jobId = await authedT.mutation(api.kb.crawl.startCrawl, {
      kbId,
      startUrl: "docs.example.com"
    })
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.startUrl).toBe("https://docs.example.com/")
  })
})
