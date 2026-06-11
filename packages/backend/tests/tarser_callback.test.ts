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

  it("rejects a callback whose token does not match the stored job token", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    await seedTarserJob(
      t,
      kbId as unknown as string,
      userId as unknown as string
    )
    // Valid signature over (svc-1 | "wrong"), but the stored job token is "tok".
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "wrong",
      secret: SECRET
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=wrong", {
      method: "POST",
      headers: { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "url_done",
        service_job_id: "svc-1",
        url: "https://example.com/p",
        status: "ok",
        finish_reason: "finished",
        markdown: "# Hello",
        metadata: { title: "x", depth: 0 }
      })
    })
    expect(res.status).toBe(401)
  })

  it("counts a url_done failure toward the job's failed stat", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedTarserJob(
      t,
      kbId as unknown as string,
      userId as unknown as string
    )
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "tok",
      secret: SECRET
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "url_done",
        service_job_id: "svc-1",
        url: "https://example.com/bad",
        status: "failed",
        finish_reason: "fetch_error",
        error: "boom"
      })
    })
    expect(res.status).toBe(200)
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.stats.failed).toBe(1)
    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(docs.length).toBe(0) // a failure is not stored as a document
  })

  it("ignores a page callback for a cancelled job", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("crawlJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        userId,
        startUrl: "https://example.com",
        config: { maxPages: 10, maxDepth: 2 },
        status: "cancelled",
        stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
        backend: "tarser",
        serviceJobId: "svc-1",
        callbackToken: "tok",
        createdAt: Date.now()
      })
    )
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "tok",
      secret: SECRET
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "url_done",
        service_job_id: "svc-1",
        url: "https://example.com/p",
        status: "ok",
        finish_reason: "finished",
        markdown: "# Hello",
        metadata: { title: "x", depth: 0 }
      })
    })
    expect(res.status).toBe(200)
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.stats.scraped).toBe(0) // no ingestion after cancel
  })

  it("rejects a callback whose body service_job_id differs from the signed job id", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    await seedTarserJob(
      t,
      kbId as unknown as string,
      userId as unknown as string
    )

    // Valid signature/header for svc-1, but the body claims a different job.
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "tok",
      secret: SECRET
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "url_done",
        service_job_id: "svc-2",
        url: "https://example.com/evil",
        status: "ok",
        finish_reason: "finished",
        markdown: "# Injected",
        metadata: { title: "x", depth: 0 }
      })
    })
    expect(res.status).toBe(401)
  })

  it("job_complete with remote failed=0 does not erase locally-counted failures", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    // A page-failed callback already bumped the local failed count to 1.
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("crawlJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        userId,
        startUrl: "https://example.com",
        config: { maxPages: 10, maxDepth: 2 },
        status: "running",
        stats: { discovered: 2, scraped: 1, failed: 1, skipped: 0 },
        backend: "tarser",
        serviceJobId: "svc-1",
        callbackToken: "tok",
        createdAt: Date.now()
      })
    )
    const sig = await computeCallbackSignature({
      jobId: "svc-1",
      token: "tok",
      secret: SECRET
    })
    // Remote final_stats omits failed (treated as 0) with a normal finish.
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: { "X-Tarser-Signature": sig, "X-Tarser-Job-Id": "svc-1" },
      body: JSON.stringify({
        event: "job_complete",
        service_job_id: "svc-1",
        final_stats: { visited: 2, skipped: 0 },
        finish_reason: "finished"
      })
    })
    expect(res.status).toBe(200)
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    // The local failure survives, so the job is flagged, not silently "completed".
    expect(job?.status).toBe("completed_with_errors")
  })
})
