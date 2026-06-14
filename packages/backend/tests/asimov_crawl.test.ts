import { beforeAll, describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
})

const STALE_MS = 31 * 60 * 1000

async function seedAsimovJob(
  t: ReturnType<typeof setupTest>,
  overrides: Record<string, unknown> = {}
): Promise<Id<"crawlJobs">> {
  const userId = await seedUser(t)
  const kbId = await seedKB(t, userId)
  return await t.run(async (ctx) =>
    ctx.db.insert("crawlJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      userId,
      startUrl: "https://example.com",
      config: { maxPages: 1000, maxDepth: 5 },
      status: "running",
      stats: { discovered: 1, scraped: 5, failed: 0, skipped: 0 },
      backend: "asimov",
      serviceJobId: "dr-1",
      createdAt: Date.now(),
      ...overrides
    })
  )
}

async function scheduledNames(t: ReturnType<typeof setupTest>): Promise<string[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.system.query("_scheduled_functions").collect()
    return rows.map((r) => r.name)
  })
}

describe("attachServiceJob cancel dispatch (#4)", () => {
  it("routes a cancelled Asimov job to cancelAsimovCrawl, not cancelTarserCrawl", async () => {
    const t = setupTest()
    const jobId = await seedAsimovJob(t, { status: "cancelled" })
    await t.mutation(internal.kb.crawl.attachServiceJob, {
      crawlJobId: jobId,
      serviceJobId: "dr-1"
    })
    const names = await scheduledNames(t)
    expect(names.some((n) => n.includes("cancelAsimovCrawl"))).toBe(true)
    expect(names.some((n) => n.includes("cancelTarserCrawl"))).toBe(false)
  })
})

describe("reaper heartbeat for long Asimov crawls (#2)", () => {
  it("a stale Asimov crawl with no activity IS reaped", async () => {
    const t = setupTest()
    const old = Date.now() - STALE_MS
    const jobId = await seedAsimovJob(t, { submittedAt: old, createdAt: old })
    await t.mutation(internal.kb.crawl.reapStaleCrawls, {})
    const job = await t.run((ctx) => ctx.db.get(jobId))
    // scraped > 0 → completed_with_errors; the point is it left "running".
    expect(job?.status).toBe("completed_with_errors")
  })

  it("touchCrawlActivity bumps lastCallbackAt so the reaper spares a healthy long crawl", async () => {
    const t = setupTest()
    const old = Date.now() - STALE_MS
    const jobId = await seedAsimovJob(t, { submittedAt: old, createdAt: old })
    await t.mutation(internal.kb.crawl.touchCrawlActivity, { crawlJobId: jobId })
    await t.mutation(internal.kb.crawl.reapStaleCrawls, {})
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe("running")
  })
})

describe("pollAsimovCrawl leaves a terminal job untouched (#9 + #11)", () => {
  it("does not re-poll or clobber a job already finalized by the reaper", async () => {
    const t = setupTest()
    const jobId = await seedAsimovJob(t, {
      status: "completed_with_errors",
      finishReason: "finished"
    })
    await t.action(internal.kb.crawl_actions.pollAsimovCrawl, {
      crawlJobId: jobId
    })
    const job = await t.run((ctx) => ctx.db.get(jobId))
    // Terminal job must be left untouched (not clobbered to "failed").
    expect(job?.status).toBe("completed_with_errors")
    const names = await scheduledNames(t)
    expect(names.some((n) => n.includes("pollAsimovCrawl"))).toBe(false)
  })
})

describe("markAsimovCrawlFailed does not clobber a terminal job (#9)", () => {
  it("leaves a cancelled job cancelled", async () => {
    const t = setupTest()
    const jobId = await seedAsimovJob(t, { status: "cancelled" })
    await t.mutation(internal.kb.crawl.markAsimovCrawlFailed, {
      crawlJobId: jobId,
      error: "poll error after cancel"
    })
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe("cancelled")
  })

  it("fails a still-running job", async () => {
    const t = setupTest()
    const jobId = await seedAsimovJob(t)
    await t.mutation(internal.kb.crawl.markAsimovCrawlFailed, {
      crawlJobId: jobId,
      error: "boom"
    })
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe("failed")
  })
})
