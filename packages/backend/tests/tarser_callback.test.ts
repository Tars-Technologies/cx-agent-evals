import {
  computeBodyHash,
  computeCallbackSignature
} from "@tars-inc/eval-lib/scraper"
import { beforeAll, describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

const SECRET = "test-secret"

beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
  process.env.TARSER_CALLBACK_HMAC_SECRET = SECRET
})

async function signedHeaders(
  body: string,
  opts: { jobId?: string; token?: string; ts?: string; nonce?: string } = {}
) {
  const jobId = opts.jobId ?? "svc-1"
  const token = opts.token ?? "tok"
  const timestamp = opts.ts ?? String(Math.floor(Date.now() / 1000))
  const nonce = opts.nonce ?? crypto.randomUUID().replace(/-/g, "")
  const bodyHash = await computeBodyHash(body)
  const signature = await computeCallbackSignature({
    serviceJobId: jobId,
    token,
    timestamp,
    nonce,
    bodyHash,
    secret: SECRET
  })
  return {
    "X-Tarser-Job-Id": jobId,
    "X-Tarser-Timestamp": timestamp,
    "X-Tarser-Nonce": nonce,
    "X-Tarser-Signature": signature
  }
}

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
    const body = JSON.stringify({
      event: "job_complete",
      service_job_id: "svc-1",
      final_stats: {},
      finish_reason: "finished"
    })
    const headers = await signedHeaders(body)
    headers["X-Tarser-Signature"] = "deadbeef"
    const res = await t.fetch("/tarser/cb?jobId=any&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(res.status).toBe(401)
  })

  it("rejects a tampered body with 401", async () => {
    const t = setupTest()
    const body = JSON.stringify({
      event: "job_complete",
      service_job_id: "svc-1",
      final_stats: {},
      finish_reason: "finished"
    })
    const headers = await signedHeaders(body)
    // Flip one byte after signing: the body hash no longer matches.
    const tampered = `${body.slice(0, -2)}X}`
    const res = await t.fetch("/tarser/cb?jobId=any&token=tok", {
      method: "POST",
      headers,
      body: tampered
    })
    expect(res.status).toBe(401)
  })

  it("rejects a stale timestamp with 401", async () => {
    const t = setupTest()
    const body = JSON.stringify({
      event: "job_complete",
      service_job_id: "svc-1",
      final_stats: {},
      finish_reason: "finished"
    })
    const headers = await signedHeaders(body, {
      ts: String(Math.floor(Date.now() / 1000) - 1000)
    })
    const res = await t.fetch("/tarser/cb?jobId=any&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(res.status).toBe(401)
  })

  it("persists a url_done page and is idempotent on a same-nonce replay", async () => {
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
    // Same headers (same nonce) twice: the second delivery is a replay.
    const headers = await signedHeaders(body, {
      nonce: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    })

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

  it("a replayed nonce is acked but does not re-apply the event", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedTarserJob(
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
    const headers = await signedHeaders(body, {
      nonce: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    })

    const first = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(first.status).toBe(200)
    const statsAfterFirst = (await t.run(async (ctx) => ctx.db.get(jobId)))
      ?.stats

    const second = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers,
      body
    })
    expect(second.status).toBe(200)

    // DB unchanged: same stats, single document, single claimed nonce.
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.stats).toEqual(statsAfterFirst)
    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(docs.length).toBe(1)
    const nonces = await t.run(async (ctx) =>
      ctx.db.query("tarserCallbackNonces").collect()
    )
    expect(nonces.length).toBe(1)
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
    // Validly signed for token "wrong", but the stored job token is "tok".
    const body = JSON.stringify({
      event: "url_done",
      service_job_id: "svc-1",
      url: "https://example.com/p",
      status: "ok",
      finish_reason: "finished",
      markdown: "# Hello",
      metadata: { title: "x", depth: 0 }
    })
    const headers = await signedHeaders(body, { token: "wrong" })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=wrong", {
      method: "POST",
      headers,
      body
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
    const body = JSON.stringify({
      event: "url_done",
      service_job_id: "svc-1",
      url: "https://example.com/bad",
      status: "failed",
      finish_reason: "fetch_error",
      error: "boom"
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: await signedHeaders(body),
      body
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
    const body = JSON.stringify({
      event: "url_done",
      service_job_id: "svc-1",
      url: "https://example.com/p",
      status: "ok",
      finish_reason: "finished",
      markdown: "# Hello",
      metadata: { title: "x", depth: 0 }
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: await signedHeaders(body),
      body
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

    // Validly signed for svc-1, but the body claims a different job.
    const body = JSON.stringify({
      event: "url_done",
      service_job_id: "svc-2",
      url: "https://example.com/evil",
      status: "ok",
      finish_reason: "finished",
      markdown: "# Injected",
      metadata: { title: "x", depth: 0 }
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: await signedHeaders(body),
      body
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
    // Remote final_stats omits failed (treated as 0) with a normal finish.
    const body = JSON.stringify({
      event: "job_complete",
      service_job_id: "svc-1",
      final_stats: { visited: 2, skipped: 0 },
      finish_reason: "finished"
    })
    const res = await t.fetch("/tarser/cb?jobId=svc-1&token=tok", {
      method: "POST",
      headers: await signedHeaders(body),
      body
    })
    expect(res.status).toBe(200)
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    // The local failure survives, so the job is flagged, not silently "completed".
    expect(job?.status).toBe("completed_with_errors")
  })
})

describe("crawl callback terminal/empty-url guards", () => {
  async function seedJob(
    t: ReturnType<typeof setupTest>,
    kbId: string,
    userId: string,
    status: "running" | "completed" | "completed_with_errors" | "failed",
    finishReason?: string
  ) {
    return await t.run(async (ctx) =>
      ctx.db.insert("crawlJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        userId,
        startUrl: "https://example.com",
        config: { maxPages: 10, maxDepth: 2 },
        status,
        stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
        backend: "tarser",
        serviceJobId: "svc-1",
        callbackToken: "tok",
        createdAt: Date.now(),
        ...(finishReason ? { finishReason } : {})
      })
    )
  }

  async function kbDocCount(t: ReturnType<typeof setupTest>, kbId: string) {
    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    return docs.length
  }

  it("ignores a page callback for an already-terminal job (no late re-ingest)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedJob(
      t,
      kbId as unknown as string,
      userId as unknown as string,
      "completed"
    )
    await t.mutation(internal.kb.crawl.handleTarserPage, {
      crawlJobId: jobId,
      url: "https://example.com/late",
      title: "Late",
      markdown: "# Late page content"
    })
    expect(await kbDocCount(t, kbId as unknown as string)).toBe(0)
  })

  it("does not let a late job_complete resurrect a reaped (failed) job", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedJob(
      t,
      kbId as unknown as string,
      userId as unknown as string,
      "failed",
      "reaped: no callback activity"
    )
    await t.mutation(internal.kb.crawl.handleTarserJobComplete, {
      crawlJobId: jobId,
      finishReason: "finished",
      stats: { visited: 1, failed: 0 }
    })
    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe("failed")
    expect(job?.finishReason).toBe("reaped: no callback activity")
  })

  it("skips a page callback with an empty url (no orphan document)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedJob(
      t,
      kbId as unknown as string,
      userId as unknown as string,
      "running"
    )
    await t.mutation(internal.kb.crawl.handleTarserPage, {
      crawlJobId: jobId,
      url: "",
      title: "",
      markdown: "# Has content but no url"
    })
    expect(await kbDocCount(t, kbId as unknown as string)).toBe(0)
  })
})

describe("reapStaleCrawls backend scoping", () => {
  it("reaps a stale Tarser crawl and leaves in-process jobs untouched", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const old = Date.now() - 60 * 60 * 1000 // 1h ago, past CRAWL_STALE_MS

    // An orphaned in-process job sits as an older "running" row; it must neither
    // be reaped here nor starve the bounded Tarser batch.
    const inproc = await t.run(async (ctx) =>
      ctx.db.insert("crawlJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        userId,
        startUrl: "https://a.example.com",
        config: { maxPages: 5, maxDepth: 1 },
        status: "running",
        stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
        backend: "inprocess",
        createdAt: old
      })
    )
    const tarser = await t.run(async (ctx) =>
      ctx.db.insert("crawlJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        userId,
        startUrl: "https://b.example.com",
        config: { maxPages: 5, maxDepth: 1 },
        status: "running",
        stats: { discovered: 1, scraped: 0, failed: 0, skipped: 0 },
        backend: "tarser",
        serviceJobId: "svc-stale",
        callbackToken: "tok",
        submittedAt: old,
        createdAt: old
      })
    )

    const res = await t.mutation(internal.kb.crawl.reapStaleCrawls, {})
    expect(res.reaped).toBe(1)
    expect((await t.run(async (ctx) => ctx.db.get(tarser)))?.status).toBe(
      "failed"
    )
    expect((await t.run(async (ctx) => ctx.db.get(inproc)))?.status).toBe(
      "running"
    )
  })
})
