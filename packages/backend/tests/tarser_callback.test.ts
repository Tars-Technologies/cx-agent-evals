import { computeCallbackSignature } from "@tars-inc/eval-lib/scraper"
import { beforeAll, describe, expect, it } from "vitest"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

const SECRET = "test-secret"

beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
  process.env.TARSER_CALLBACK_HMAC_SECRET = SECRET
})

async function seedTarserJob(
  t: ReturnType<typeof setupTest>,
  kbId: string,
  userId: string
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("crawlJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      userId,
      startUrl: "https://example.com",
      config: { maxPages: 10, maxDepth: 2 },
      status: "running",
      stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
      backend: "tarser",
      serviceJobId: "svc-1",
      callbackToken: "tok",
      createdAt: Date.now()
    })
  )
}

describe("POST /tarser/cb", () => {
  it("rejects a bad signature with 401", async () => {
    const t = setupTest()
    const res = await t.fetch("/tarser/cb?jobId=any&token=tok", {
      method: "POST",
      headers: { "X-Tarser-Signature": "deadbeef", "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "job_complete",
        service_job_id: "svc-1",
        final_stats: {},
        finish_reason: "finished"
      })
    })
    expect(res.status).toBe(401)
  })

  it("persists a url_done page and is idempotent on repeat", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    await seedTarserJob(
      t,
      kbId as unknown as string,
      userId as unknown as string
    )

    const body = JSON.stringify({
      event: "url_done",
      service_job_id: "svc-1",
      url: "https://example.com/p",
      status: "ok",
      finish_reason: "finished",
      markdown: "# Hello",
      metadata: { title: "Example", depth: 0 },
      content_hash: "h1"
    })
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "tok",
      secret: SECRET
    })
    const headers = { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" }

    const first = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(first.status).toBe(200)
    const second = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(second.status).toBe(200)

    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(docs.length).toBe(1) // idempotent — second callback did not duplicate
  })
})
