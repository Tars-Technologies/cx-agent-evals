import {
  computeBodyHash,
  computeCallbackSignature
} from "@tars-inc/eval-lib/scraper"
import { beforeAll, describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

const SECRET = "test-secret"
const PARSE_STALE_MS = 31 * 60 * 1000

beforeAll(() => {
  process.env.SKIP_ENV_VALIDATION = "1"
  process.env.TARSER_CALLBACK_HMAC_SECRET = SECRET
})

async function seedAsimovParsingDoc(
  t: ReturnType<typeof setupTest>,
  overrides: Record<string, unknown> = {}
): Promise<Id<"documents">> {
  const userId = await seedUser(t)
  const kbId = await seedKB(t, userId)
  return await t.run(async (ctx) =>
    ctx.db.insert("documents", {
      orgId: TEST_ORG_ID,
      kbId,
      docId: "d1",
      title: "Doc",
      content: "",
      contentLength: 0,
      metadata: {},
      sourceType: "upload",
      mimeType: "application/pdf",
      parseBackend: "asimov",
      parseServiceJobId: "collide-1",
      parseToken: "",
      parseStatus: "parsing",
      createdAt: Date.now(),
      ...overrides
    })
  )
}

describe("stale-parse reaper heartbeat for asimov (#13)", () => {
  it("reaps a stale asimov parse with no activity", async () => {
    const t = setupTest()
    const docId = await seedAsimovParsingDoc(t, {
      createdAt: Date.now() - PARSE_STALE_MS
    })
    await t.mutation(internal.kb.documents.reapStaleParsing, {})
    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("failed")
  })

  it("touchParseActivity spares a healthy long-running asimov parse", async () => {
    const t = setupTest()
    const docId = await seedAsimovParsingDoc(t, {
      createdAt: Date.now() - PARSE_STALE_MS
    })
    await t.mutation(internal.kb.documents.touchParseActivity, {
      parseServiceJobId: "collide-1"
    })
    await t.mutation(internal.kb.documents.reapStaleParsing, {})
    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("parsing")
  })
})

async function signedHeaders(
  body: string,
  opts: { jobId?: string; token?: string } = {}
) {
  const jobId = opts.jobId ?? "collide-1"
  const token = opts.token ?? "tok"
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomUUID().replace(/-/g, "")
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

describe("tarser parse callback cannot finalize an asimov doc (#22)", () => {
  it("ignores a parse_done callback whose serviceJobId collides with an asimov parse", async () => {
    const t = setupTest()
    const docId = await seedAsimovParsingDoc(t)
    const body = JSON.stringify({
      event: "parse_done",
      service_job_id: "collide-1",
      status: "ok",
      markdown: "# hijacked"
    })
    const headers = await signedHeaders(body, {
      jobId: "collide-1",
      token: "attacker"
    })
    await t.fetch("/tarser/cb?jobId=collide-1&token=attacker", {
      method: "POST",
      headers,
      body
    })
    // The asimov-backed doc must remain untouched — a Tarser callback must not
    // finalize it just because the empty parseToken skips the token check.
    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("parsing")
    expect(doc?.content).toBe("")
  })
})
