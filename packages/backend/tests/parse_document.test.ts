import { describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

describe("parse document mutations", () => {
  it("createParsing then finishParse fills content and flips status", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const docId = await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "report.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-1",
      parseToken: "ptok"
    })

    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-1",
      status: "ok",
      markdown: "# Parsed"
    })

    const doc = await t.run(async (ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("done")
    expect(doc?.content).toBe("# Parsed")
  })

  it("createParsing does NOT increment documentCount; finishParse success does", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "file.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-2",
      parseToken: "ptok2"
    })

    // Still parsing — count must not have changed (field stays undefined/0).
    const kbDuring = await t.run(async (ctx) => ctx.db.get(kbId))
    expect(kbDuring?.documentCount ?? 0).toBe(0)

    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-2",
      status: "ok",
      markdown: "# Done"
    })

    // Now done — count should be 1.
    const kbAfter = await t.run(async (ctx) => ctx.db.get(kbId))
    expect(kbAfter?.documentCount).toBe(1)
  })

  it("finishParse is idempotent when doc is already done", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "file.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-3",
      parseToken: "ptok3"
    })

    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-3",
      status: "ok",
      markdown: "# First"
    })

    // Second call — should be a no-op (parseStatus is already "done")
    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-3",
      status: "ok",
      markdown: "# Second"
    })

    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_parse_service_job", (q) =>
          q.eq("parseServiceJobId", "psvc-3")
        )
        .first()
    )
    // Content should still be from the first call
    expect(docs?.content).toBe("# First")
    expect(docs?.parseStatus).toBe("done")
  })

  it("finishParse with failed status sets parseStatus to failed", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "bad.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-4",
      parseToken: "ptok4"
    })

    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-4",
      status: "failed",
      error: "parse error"
    })

    const docs = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_parse_service_job", (q) =>
          q.eq("parseServiceJobId", "psvc-4")
        )
        .first()
    )
    expect(docs?.parseStatus).toBe("failed")
    expect(docs?.metadata?.error).toBe("parse error")
  })

  it("finishParse with ok status but empty markdown is marked failed", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "empty.md",
      mimeType: "text/markdown",
      parseServiceJobId: "psvc-5",
      parseToken: "ptok5"
    })

    // Tarser returns ok + empty markdown for formats it cannot extract; that must
    // surface as failed, not a silently-empty "done" document.
    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-5",
      status: "ok",
      markdown: "   "
    })

    const doc = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_parse_service_job", (q) =>
          q.eq("parseServiceJobId", "psvc-5")
        )
        .first()
    )
    expect(doc?.parseStatus).toBe("failed")
    expect(doc?.metadata?.error).toBe("Remote parser returned no content")
  })

  it("finishParse with ok status but empty markdown is marked failed", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "empty.md",
      mimeType: "text/markdown",
      parseServiceJobId: "psvc-5",
      parseToken: "ptok5"
    })

    // Tarser returns ok + empty markdown for formats it cannot extract; that must
    // surface as failed, not a silently-empty "done" document.
    await t.mutation(internal.kb.documents.finishParse, {
      parseServiceJobId: "psvc-5",
      status: "ok",
      markdown: "   "
    })

    const doc = await t.run(async (ctx) =>
      ctx.db
        .query("documents")
        .withIndex("by_parse_service_job", (q) =>
          q.eq("parseServiceJobId", "psvc-5")
        )
        .first()
    )
    expect(doc?.parseStatus).toBe("failed")
  })

  it("createParsed creates a done document with correct fields", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    // Store a fake blob so we have a valid _storage ID for computeDocId
    const fileId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["<h1>Hello</h1>"], { type: "text/html" }))
    )

    const docId = await t.mutation(internal.kb.documents.createParsed, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "My Doc",
      content: "# Hello\n\nWorld",
      mimeType: "text/html",
      fileId
    })

    const doc = await t.run(async (ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("done")
    expect(doc?.parseBackend).toBe("inprocess")
    expect(doc?.content).toBe("# Hello\n\nWorld")
    expect(doc?.contentLength).toBe("# Hello\n\nWorld".length)
    expect(doc?.sourceType).toBe("upload")
  })

  it("recordParseFailure surfaces a failed upload document", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const fileId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "text/markdown" }))
    )

    const docId = await t.mutation(internal.kb.documents.recordParseFailure, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "down.md",
      mimeType: "text/markdown",
      backend: "tarser",
      fileId,
      error: "Tarser is unreachable"
    })

    const doc = await t.run(async (ctx) => ctx.db.get(docId))
    expect(doc?.parseStatus).toBe("failed")
    expect(doc?.parseBackend).toBe("tarser")
    expect(doc?.content).toBe("")
  })

  it("reapStaleParsing fails old parsing docs but leaves fresh ones", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    // Fresh parsing doc (just created) — must be left alone.
    const freshId = await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "fresh.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-fresh",
      parseToken: "tok-fresh"
    })
    // Stale parsing doc — backdate createdAt past the 30-min TTL.
    const staleId = await t.mutation(internal.kb.documents.createParsing, {
      orgId: TEST_ORG_ID,
      kbId,
      title: "stale.pdf",
      mimeType: "application/pdf",
      parseServiceJobId: "psvc-stale",
      parseToken: "tok-stale"
    })
    await t.run(async (ctx) =>
      ctx.db.patch(staleId, { createdAt: Date.now() - 60 * 60 * 1000 })
    )

    const { reaped } = await t.mutation(
      internal.kb.documents.reapStaleParsing,
      {}
    )
    expect(reaped).toBe(1)

    const fresh = await t.run(async (ctx) => ctx.db.get(freshId))
    const stale = await t.run(async (ctx) => ctx.db.get(staleId))
    expect(fresh?.parseStatus).toBe("parsing")
    expect(stale?.parseStatus).toBe("failed")
    expect(stale?.metadata?.error).toMatch(/timed out/i)
  })
})
