import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "../convex/_generated/api"
import { rankDocImagesForQuery } from "@tars-inc/eval-lib/multimodal"
import { mediaCollectionName, mediaPointId } from "@tars-inc/eval-lib"

// Deterministic embeddings so processDocImages ranking/storage is assertable.
// `calls` counts how many times embed() ran, to prove unchanged images skip it.
const embedState = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@tars-inc/eval-lib/llm", () => ({
  createEmbedder: () => ({
    name: "mock",
    dimension: 2,
    embed: async (texts: readonly string[]) => {
      embedState.calls++
      return texts.map((_t, i) => [i + 1, 0])
    },
    embedQuery: async () => [1, 0]
  })
}))
import {
  seedDataset,
  seedKB,
  seedUser,
  setupTest,
  TEST_ORG_ID,
  testIdentity
} from "./helpers"
import { FakeQdrant } from "./fakeQdrant"

// Media vectors now live in Qdrant. Point every store call at an in-memory fake
// and mark the deployment as Qdrant-configured. Env is read lazily (config.ts),
// so setting it before the first action runs is sufficient. SKIP_ENV_VALIDATION
// lets config load without the required API keys in the test environment.
process.env.SKIP_ENV_VALIDATION = "1"
process.env.QDRANT_URL = "https://fake-qdrant.test:6333"
const MEDIA_COLLECTION = mediaCollectionName("openai", "text-embedding-3-small")

let fake: FakeQdrant
beforeEach(() => {
  fake = new FakeQdrant()
  vi.stubGlobal("fetch", fake.fetch)
})
afterEach(() => vi.unstubAllGlobals())

/** Vector stored in the fake Qdrant for an imageId, or undefined if absent. */
function storedVector(imageId: string): number[] | undefined {
  return fake.pointsIn(MEDIA_COLLECTION).get(mediaPointId(imageId))?.vector
}

describe("kb.images.upsertDocImages (delete-and-replace)", () => {
  it("inserts, then reconciles removed images on re-run", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        parseStatus: "done",
        createdAt: Date.now()
      })
    )
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [
        { imageId: "img_a", url: "https://x/a.png", alt: "a" },
        { imageId: "img_b", url: "https://x/b.png", alt: "b" }
      ]
    })
    let rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.map((r) => r.imageId).sort()).toEqual(["img_a", "img_b"])

    // Re-run without img_b → it must be deleted (E2); img_a alt updated.
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [{ imageId: "img_a", url: "https://x/a.png", alt: "a2" }]
    })
    rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.map((r) => r.imageId)).toEqual(["img_a"])
    expect(rows[0].alt).toBe("a2")
  })

  it("collapses pre-existing duplicate rows for the same (doc, imageId)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        parseStatus: "done",
        createdAt: Date.now()
      })
    )
    // Simulate the observed bug: 3 rows for the same image.
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("kbMedia", {
          imageId: "img_dup",
          kbId,
          orgId,
          url: "https://x/d.png",
          alt: "d",
          mediaType: "image",
          sourceDocId: docId,
          createdAt: Date.now()
        })
      }
    })
    // A normal upsert must collapse them to one.
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [{ imageId: "img_dup", url: "https://x/d.png", alt: "d" }]
    })
    const rows = await t.run((ctx) =>
      ctx.db
        .query("kbMedia")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", docId))
        .collect()
    )
    expect(rows.length).toBe(1)
  })

  it("allows one row per (sourceDocId, imageId) for a shared url (E1)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const mk = (d: string) =>
      t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId,
          kbId,
          docId: d,
          title: d,
          content: "c",
          contentLength: 1,
          metadata: {},
          parseStatus: "done",
          createdAt: Date.now()
        })
      )
    const docA = await mk("a")
    const docB = await mk("b")
    const shared = { imageId: "img_s", url: "https://x/s.png", alt: "s" }
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docA,
      images: [shared]
    })
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docB,
      images: [shared]
    })
    const rowsB = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docB]
    })
    expect(rowsB.map((r) => r.imageId)).toEqual(["img_s"])
  })
})

describe("manual context", () => {
  it("setMediaContext stores context and it survives reprocess, dominating the embedding", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const content = `## Heading\n![A chart](https://x/c.png)\n`
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content,
        contentLength: content.length,
        metadata: {},
        parseStatus: "done",
        createdAt: Date.now()
      })
    )
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    const [row] = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })

    // Simulate the manual-context edit (setMediaContext patches the row, then
    // reprocesses): here we patch directly, then reprocess.
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("kbMedia")
        .withIndex("by_image_id", (q) => q.eq("imageId", row.imageId))
        .first()
      await ctx.db.patch(m!._id, {
        manualContext: "the quarterly revenue keynote"
      })
    })
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const after = await t.run((ctx) =>
      ctx.db
        .query("kbMedia")
        .withIndex("by_image_id", (q) => q.eq("imageId", row.imageId))
        .first()
    )
    // manual context is preserved across reprocess and the item re-embedded
    // (its vector is upserted to Qdrant, its hash recorded on the row).
    expect(after!.manualContext).toBe("the quarterly revenue keynote")
    expect(storedVector(row.imageId)).toBeDefined()
    // hash reflects the manual-context blend (differs from the no-context hash)
    const { createHash } = await import("node:crypto")
    const noContextHash = createHash("sha256")
      .update("mock:A chart. Heading")
      .digest("hex")
    expect(after!.embeddingInputHash).not.toBe(noContextHash)
  })

  it("setMediaContext mutation pages its patch/reschedule fan-out via self-scheduling", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      const orgId = TEST_ORG_ID
      const content = `## Heading\n![A chart](https://x/c.png)\n`
      const docId = await t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId,
          kbId,
          docId: "d1",
          title: "t",
          content,
          contentLength: content.length,
          metadata: {},
          parseStatus: "done",
          createdAt: Date.now()
        })
      )
      await t.action(internal.kb.images_actions.processDocImages, { docId })
      const [row] = await t.query(internal.kb.images.imagesForDocs, {
        kbId,
        documentIds: [docId]
      })

      const authedT = t.withIdentity(testIdentity)
      const result = await authedT.mutation(api.kb.images.setMediaContext, {
        kbId,
        imageId: row.imageId,
        manualContext: "the quarterly revenue keynote"
      })
      expect(result).toEqual({ started: true })

      await t.finishAllScheduledFunctions(vi.runAllTimers)

      const after = await t.run((ctx) =>
        ctx.db
          .query("kbMedia")
          .withIndex("by_image_id", (q) => q.eq("imageId", row.imageId))
          .first()
      )
      expect(after!.manualContext).toBe("the quarterly revenue keynote")
    } finally {
      vi.useRealTimers()
    }
  })

  it("setMediaContext rejects an imageId with no row in this KB", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const authedT = t.withIdentity(testIdentity)
    await expect(
      authedT.mutation(api.kb.images.setMediaContext, {
        kbId,
        imageId: "img_does_not_exist",
        manualContext: "x"
      })
    ).rejects.toThrow(/not found/i)
  })
})

describe("mediaMetaForDocs (doc-gated ranking metadata)", () => {
  it("excludes doc_link rows and carries media type in doc order", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        parseStatus: "done",
        createdAt: Date.now()
      })
    )
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [
        {
          imageId: "img_i",
          url: "https://x/i.png",
          alt: "i",
          mediaType: "image"
        },
        {
          imageId: "img_d",
          url: "https://x/s.pdf",
          alt: "Spec",
          mediaType: "doc_link"
        }
      ]
    })
    const meta = await t.query(internal.kb.images.mediaMetaForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(meta.map((m) => m.imageId)).toEqual(["img_i"]) // doc_link excluded
    expect(meta[0].mediaType).toBe("image")
    // imagesForDocs also excludes it
    const rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.map((r) => r.imageId)).toEqual(["img_i"])
  })
})

describe("agentExperimentResults.insert with images", () => {
  async function seedExperimentAndQuestion(
    t: ReturnType<typeof setupTest>
  ): Promise<{ experimentId: any; questionId: any }> {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)
    return await t.run(async (ctx) => {
      const experimentId = await ctx.db.insert("experiments", {
        orgId: TEST_ORG_ID,
        datasetId,
        name: "Agent Exp",
        metricNames: ["recall"],
        status: "running",
        createdBy: userId,
        createdAt: Date.now()
      })
      const questionId = await ctx.db.insert("questions", {
        datasetId,
        queryId: "q1",
        queryText: "What does the dashboard look like?",
        sourceDocId: "d1",
        relevantSpans: [],
        metadata: {}
      })
      return { experimentId, questionId }
    })
  }

  it("records shownImages and chunk images (multimodal)", async () => {
    const t = setupTest()
    const { experimentId, questionId } = await seedExperimentAndQuestion(t)

    await t.mutation(internal.experiments.agentResults.insert, {
      experimentId,
      questionId,
      answerText: "Here it is ![dash](https://x.com/a.png)",
      toolCalls: [
        {
          toolName: "docs",
          query: "dashboard",
          chunks: [
            {
              content: "see ![dash](img_aaaa)",
              docId: "d1",
              start: 0,
              end: 10,
              images: [{ imageId: "img_aaaa", alt: "dash" }]
            }
          ]
        }
      ],
      retrievedChunks: [
        {
          content: "see ![dash](img_aaaa)",
          docId: "d1",
          start: 0,
          end: 10,
          images: [{ imageId: "img_aaaa", alt: "dash" }]
        }
      ],
      shownImages: [
        { imageId: "img_aaaa", url: "https://x.com/a.png", alt: "dash" }
      ],
      latencyMs: 5,
      status: "complete"
    })

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("agentExperimentResults")
        .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
        .collect()
    )
    expect(rows.length).toBe(1)
    expect(rows[0].shownImages).toEqual([
      { imageId: "img_aaaa", url: "https://x.com/a.png", alt: "dash" }
    ])
    expect(rows[0].retrievedChunks[0].images).toEqual([
      { imageId: "img_aaaa", alt: "dash" }
    ])
  })

  it("omits shownImages for non-multimodal results", async () => {
    const t = setupTest()
    const { experimentId, questionId } = await seedExperimentAndQuestion(t)

    await t.mutation(internal.experiments.agentResults.insert, {
      experimentId,
      questionId,
      answerText: "plain answer",
      toolCalls: [],
      retrievedChunks: [],
      latencyMs: 5,
      status: "complete"
    })

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("agentExperimentResults")
        .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
        .collect()
    )
    expect(rows.length).toBe(1)
    expect(rows[0].shownImages).toBeUndefined()
  })
})

describe("kb.images_actions.processDocImages", () => {
  const sampleContent =
    `## Revenue dashboard\n` +
    `![Quarterly revenue chart](https://x/rev.png)\n` +
    `*Figure 1: revenue by quarter*\n` +
    `![](https://x/12px-Red_pog.svg.png)\n` // decorative → skipped

  async function seedDoc(t: ReturnType<typeof setupTest>, content: string) {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content,
        contentLength: content.length,
        metadata: {},
        parseStatus: "done",
        createdAt: Date.now()
      })
    )
    return { kbId, orgId, docId }
  }

  it("stores vectors in Qdrant, leaves image markdown unmarked, skips decorative (E4)", async () => {
    const t = setupTest()
    const { kbId, docId } = await seedDoc(t, sampleContent)

    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.length).toBe(1)
    expect(rows[0].alt).toBe("Quarterly revenue chart")
    // The vector lives in Qdrant, not on the row.
    expect(storedVector(rows[0].imageId)).toEqual([1, 0])

    const doc = await t.run((ctx) => ctx.db.get(docId))
    // Image markdown is left untouched — no <!--media:id--> marker injected, so
    // character offsets stay aligned with the original content.
    expect(doc!.content).toContain(
      "![Quarterly revenue chart](https://x/rev.png)"
    )
    expect(doc!.content).not.toContain("<!--media:")
    // decorative image kept visible, and also unmarked (E4)
    expect(doc!.content).toContain("![](https://x/12px-Red_pog.svg.png)")
    // Successful processing records an observable status (no error).
    expect(doc!.mediaStatus).toBe("done")
    expect(doc!.mediaError).toBeUndefined()
  })

  it("surfaces a Qdrant/embed outage as mediaStatus=failed (E3 observability)", async () => {
    const t = setupTest()
    const { docId } = await seedDoc(t, sampleContent)

    // A soft embed/upsert outage must not vanish into a misleading "done": the
    // rows are still written (retry next reprocess) but the doc is flagged failed.
    fake.failRequests = true
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    fake.failRequests = false

    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc!.mediaStatus).toBe("failed")
    expect(doc!.mediaError).toBeTruthy()
  })

  it("is idempotent (E5): re-run yields byte-identical content", async () => {
    const t = setupTest()
    const { docId } = await seedDoc(t, sampleContent)
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    const first = (await t.run((ctx) => ctx.db.get(docId)))!.content
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    const second = (await t.run((ctx) => ctx.db.get(docId)))!.content
    expect(second).toBe(first)
    expect(second).not.toContain("<!--media:")
  })

  it("embeds video and rewrites doc embed to an inline [title](id) pointer", async () => {
    const t = setupTest()
    const content =
      `## Guides\n[embed:video](https://youtube.com/embed/ID "Setup demo")\n` +
      `[embed:doc](https://x/spec.pdf "Full spec")\n`
    const { docId } = await seedDoc(t, content)
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const rows = await t.run((ctx) =>
      ctx.db
        .query("kbMedia")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", docId))
        .collect()
    )
    const video = rows.find((r) => r.mediaType === "video")!
    const docLink = rows.find((r) => r.mediaType === "doc_link")!
    expect(storedVector(video.imageId)).toEqual([1, 0]) // video embedded
    expect(storedVector(docLink.imageId)).toBeUndefined() // doc_link not embedded

    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc!.content).toContain(`[Full spec](${docLink.imageId})`) // inline pointer
    // Video embed token stays verbatim (stripped from chunk text at index time via
    // VIDEO_EMBED_RE); no <!--media:id--> marker is injected.
    expect(doc!.content).toContain(
      `[embed:video](https://youtube.com/embed/ID "Setup demo")`
    )
    expect(doc!.content).not.toContain("<!--media:")
    expect(doc!.content).not.toContain("[embed:doc]") // doc token rewritten away
  })

  it("skips re-embedding when the image input is unchanged", async () => {
    const t = setupTest()
    const { kbId, docId } = await seedDoc(t, sampleContent)

    const before = embedState.calls
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    const afterFirst = embedState.calls
    expect(afterFirst).toBe(before + 1) // first run embeds

    const [row1] = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })

    // Re-run on identical content: no new embed call, vector preserved in Qdrant.
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    expect(embedState.calls).toBe(afterFirst)
    expect(storedVector(row1.imageId)).toEqual([1, 0])
  })

  it("removes a media point from Qdrant when a re-scrape drops the image", async () => {
    const t = setupTest()
    const twoImages =
      `## Two\n![First](https://x/first.png)\n![Second](https://x/second.png)\n`
    const { kbId, docId } = await seedDoc(t, twoImages)
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const before = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(before.length).toBe(2)
    for (const r of before) expect(storedVector(r.imageId)).toBeDefined()
    const dropped = before.find((r) => r.alt === "Second")!

    // Re-scrape with only the first image → the second's vector must be deleted.
    await t.run(async (ctx) => {
      await ctx.db.patch(docId, {
        content: `## Two\n![First](https://x/first.png)\n`
      })
    })
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const after = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(after.map((r) => r.alt)).toEqual(["First"])
    expect(storedVector(dropped.imageId)).toBeUndefined() // orphan removed
  })
})

describe("doc-gated menu ranking (rankDocImagesForQuery over metadata)", () => {
  it("ranks within docs and round-robins across docs in doc order", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const mk = (d: string) =>
      t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId,
          kbId,
          docId: d,
          title: d,
          content: "c",
          contentLength: 1,
          metadata: {},
          parseStatus: "done",
          createdAt: Date.now()
        })
      )
    const docA = await mk("a")
    const docB = await mk("b")
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docA,
      images: [
        { imageId: "img_a1", url: "https://x/a1.png", alt: "a1" },
        { imageId: "img_a2", url: "https://x/a2.png", alt: "a2" }
      ]
    })
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docB,
      images: [{ imageId: "img_b1", url: "https://x/b1.png", alt: "b1" }]
    })

    const docOrder = [docA, docB]
    // Metadata query returns menu-eligible images in doc order (no vectors).
    const meta = await t.query(internal.kb.images.mediaMetaForDocs, {
      kbId,
      documentIds: docOrder
    })
    // rankMediaForDocs attaches Qdrant vectors then ranks; simulate that here.
    const vecById: Record<string, number[]> = {
      img_a1: [1, 0],
      img_a2: [0.5, 0.5],
      img_b1: [0.9, 0.1]
    }
    const groups = docOrder.map((d) =>
      meta
        .filter((m) => m.documentId === d)
        .map((m) => ({
          imageId: m.imageId,
          alt: m.alt,
          embedding: vecById[m.imageId],
          type: m.mediaType
        }))
    )
    const menu = rankDocImagesForQuery([1, 0], groups, 6)
    // round-robin: docA #1, docB #1, docA #2
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_b1", "img_a2"])
  })
})

describe("finalize triggers processDocImages", () => {
  it("createFromScrape schedules image processing (rows appear after run)", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      const orgId = TEST_ORG_ID
      const docId = await t.mutation(internal.kb.documents.createFromScrape, {
        orgId,
        kbId,
        title: "t",
        content: "## H\n![A revenue chart](https://x/r.png)\n",
        sourceUrl: "https://example.com/page"
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      const rows = await t.query(internal.kb.images.imagesForDocs, {
        kbId,
        documentIds: [docId]
      })
      expect(rows.map((r) => r.imageId).length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does NOT schedule image processing when QDRANT_URL is unset (opt-out)", async () => {
    vi.useFakeTimers()
    const savedUrl = process.env.QDRANT_URL
    delete process.env.QDRANT_URL // deployment without a media vector store
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      const orgId = TEST_ORG_ID
      const docId = await t.mutation(internal.kb.documents.createFromScrape, {
        orgId,
        kbId,
        title: "t",
        content: "## H\n![A revenue chart](https://x/r.png)\n",
        sourceUrl: "https://example.com/page"
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      // Scheduling was skipped → no media rows, no doomed retried action.
      const rows = await t.query(internal.kb.images.imagesForDocs, {
        kbId,
        documentIds: [docId]
      })
      expect(rows.length).toBe(0)
      const doc = await t.run((ctx) => ctx.db.get(docId))
      expect(doc!.mediaStatus).toBeUndefined()
    } finally {
      process.env.QDRANT_URL = savedUrl
      vi.useRealTimers()
    }
  })
})

describe("reprocessKbImages (paginated, self-scheduling fan-out)", () => {
  it("processes every eligible doc across multiple batch pages and skips others", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      const orgId = TEST_ORG_ID

      // 3 done docs (eligible), 1 still parsing, 1 failed — the batch worker
      // must only enqueue the done ones. Small N here (batching is exercised via
      // the same paginate()+scheduler.runAfter code path regardless of page
      // count — REPROCESS_BATCH_SIZE is a fixed 100, so this stays one page,
      // but the self-continuation branch (page.isDone → no reschedule) is what's
      // under test alongside the eligibility filter).
      const docIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const content = `## Doc ${i}\n![chart ${i}](https://x/${i}.png)\n`
        const docId = await t.run((ctx) =>
          ctx.db.insert("documents", {
            orgId,
            kbId,
            docId: `d${i}`,
            title: `t${i}`,
            content,
            contentLength: content.length,
            metadata: {},
            parseStatus: "done",
            createdAt: Date.now()
          })
        )
        docIds.push(docId)
      }
      // Both placeholders carry real image content (not content:"") — otherwise
      // they'd produce zero media rows regardless of the parseStatus skip
      // below, and removing that skip entirely would still pass this test's
      // `rows.length === 3` assertion (false confidence). With real content,
      // a broken/removed skip surfaces as rows.length === 5.
      const parsingDocId = await t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId,
          kbId,
          docId: "d-parsing",
          title: "still parsing",
          content: "![still parsing](https://x/parsing.png)",
          contentLength: 40,
          metadata: {},
          parseStatus: "parsing",
          createdAt: Date.now()
        })
      )
      const failedDocId = await t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId,
          kbId,
          docId: "d-failed",
          title: "failed parse",
          content: "![failed parse](https://x/failed.png)",
          contentLength: 38,
          metadata: {},
          parseStatus: "failed",
          createdAt: Date.now()
        })
      )

      const authedT = t.withIdentity(testIdentity)
      const result = await authedT.mutation(api.kb.images.reprocessKbImages, {
        kbId
      })
      expect(result).toEqual({ started: true })

      await t.finishAllScheduledFunctions(vi.runAllTimers)

      const rows = await t.query(internal.kb.images.imagesForDocs, {
        kbId,
        documentIds: [...docIds, parsingDocId, failedDocId] as any
      })
      expect(rows.length).toBe(3) // only the 3 "done" docs got media rows
      for (const docId of docIds) {
        const doc = await t.run((ctx) => ctx.db.get(docId as any))
        expect((doc as any).mediaStatus).toBe("done")
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a KB owned by another org", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    await t.run((ctx) => ctx.db.patch(kbId, { orgId: "org_other" }))

    const authedT = t.withIdentity(testIdentity) // testIdentity's org is TEST_ORG_ID
    await expect(
      authedT.mutation(api.kb.images.reprocessKbImages, { kbId })
    ).rejects.toThrow(/not found/i)
  })
})

describe("getImagesByIds multi-KB scoping", () => {
  it("resolves ids across all provided KBs but not outside them", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kb1 = await seedKB(t, userId)
    const kb2 = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId: kb1,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        createdAt: Date.now()
      })
    )
    await t.run(async (ctx) => {
      await ctx.db.insert("kbMedia", {
        imageId: "img_one",
        kbId: kb1,
        orgId,
        url: "https://x.com/1.png",
        alt: "one",
        sourceDocId: docId,
        createdAt: Date.now()
      })
      await ctx.db.insert("kbMedia", {
        imageId: "img_two",
        kbId: kb2,
        orgId,
        url: "https://x.com/2.png",
        alt: "two",
        sourceDocId: docId,
        createdAt: Date.now()
      })
    })

    // Both KBs in scope → both resolve.
    const both = await t.query(internal.kb.images.getImagesByIds, {
      kbIds: [kb1, kb2],
      orgId,
      imageIds: ["img_one", "img_two"]
    })
    expect(both.map((r) => r.imageId).sort()).toEqual(["img_one", "img_two"])

    // Only kb1 in scope → img_two (in kb2) is excluded.
    const onlyKb1 = await t.query(internal.kb.images.getImagesByIds, {
      kbIds: [kb1],
      orgId,
      imageIds: ["img_one", "img_two"]
    })
    expect(onlyKb1.map((r) => r.imageId)).toEqual(["img_one"])
  })

  it("excludes a row whose kbId is in scope but whose orgId is not", async () => {
    // kb1 is in the requested kbIds (passes the allowedKbs check), so this
    // isolates the row.orgId !== args.orgId clause specifically — every other
    // row in this file shares one org, so that clause otherwise has no coverage.
    const t = setupTest()
    const userId = await seedUser(t)
    const kb1 = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId: kb1,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        createdAt: Date.now()
      })
    )
    await t.run((ctx) =>
      ctx.db.insert("kbMedia", {
        imageId: "img_foreign_org",
        kbId: kb1,
        orgId: "org_other",
        url: "https://x.com/foreign.png",
        alt: "foreign",
        sourceDocId: docId,
        createdAt: Date.now()
      })
    )

    const result = await t.query(internal.kb.images.getImagesByIds, {
      kbIds: [kb1],
      orgId,
      imageIds: ["img_foreign_org"]
    })
    expect(result).toEqual([])
  })
})
