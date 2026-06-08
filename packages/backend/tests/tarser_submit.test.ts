import { beforeAll, describe, expect, it, vi } from "vitest"
import { api } from "../convex/_generated/api"
import { seedUser, setupTest, testIdentity } from "./helpers"

beforeAll(() => {
  // The tarser branch schedules submitTarserCrawl, which reads backendConfig -> env.
  // Skip strict env validation so a scheduled run does not throw in the test process.
  process.env.SKIP_ENV_VALIDATION = "1"
})

describe("startCrawl backend selection", () => {
  it("defaults to inprocess and records backend=inprocess", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)
    const kbId = await authedT.mutation(api.kb.core.create, { name: "Test KB" })

    const jobId = await authedT.mutation(api.kb.crawl.startCrawl, {
      kbId,
      startUrl: "https://example.com"
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.backend).toBe("inprocess")
    expect(job?.status).toBe("running")
    expect(job?.callbackToken).toBeDefined()
  })

  it("records backend=tarser, status=pending, and a callbackToken when backend=tarser", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      await seedUser(t)
      const authedT = t.withIdentity(testIdentity)
      const kbId = await authedT.mutation(api.kb.core.create, {
        name: "Test KB"
      })

      // backend=tarser takes the remote branch: no crawlUrls seed, schedules a submit.
      const jobId = await authedT.mutation(api.kb.crawl.startCrawl, {
        kbId,
        startUrl: "https://example.com",
        backend: "tarser"
      })

      // Recorded for the remote backend before the scheduled submit runs.
      const job = await t.run(async (ctx) => ctx.db.get(jobId))
      expect(job?.backend).toBe("tarser")
      expect(job?.status).toBe("pending")
      expect(typeof job?.callbackToken).toBe("string")

      // Drain the scheduled submitTarserCrawl deterministically. Tarser is unconfigured
      // here, so it makes no network call and marks the job failed via a valid write.
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      const after = await t.run(async (ctx) => ctx.db.get(jobId))
      expect(after?.status).toBe("failed")
    } finally {
      vi.useRealTimers()
    }
  })
})
