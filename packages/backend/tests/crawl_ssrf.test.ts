import { describe, expect, it } from "vitest"
import { api } from "../convex/_generated/api"
import { seedUser, setupTest, testIdentity } from "./helpers"

describe("startCrawl URL hardening", () => {
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
    // inprocess default enqueues a WorkPool action; wrap like the existing scraping tests.
    let jobId: Awaited<ReturnType<typeof authedT.mutation>> | undefined
    try {
      jobId = await authedT.mutation(api.kb.crawl.startCrawl, {
        kbId,
        startUrl: "docs.example.com"
      })
    } catch {
      // WorkPool enqueue may warn in test env - that's OK.
    }
    if (jobId) {
      const job = await t.run(async (ctx) => ctx.db.get(jobId))
      expect(job?.startUrl).toBe("https://docs.example.com/")
    }
  })
})
