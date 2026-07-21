import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { internal } from "../convex/_generated/api"
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
  TEST_ORG_ID
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
      shownImages: [{ imageId: "img_aaaa", url: "https://x.com/a.png" }],
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
      { imageId: "img_aaaa", url: "https://x.com/a.png" }
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

  it("stores vectors in Qdrant, annotates content, skips decorative (E4)", async () => {
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
    expect(doc!.content).toContain(
      `![Quarterly revenue chart](https://x/rev.png)<!--media:${rows[0].imageId}-->`
    )
    // decorative image kept visible, but not annotated (E4)
    expect(doc!.content).toContain("![](https://x/12px-Red_pog.svg.png)")
    expect(doc!.content).not.toContain("Red_pog.svg.png)<!--media")
  })

  it("is idempotent (E5): re-run does not duplicate annotations", async () => {
    const t = setupTest()
    const { docId } = await seedDoc(t, sampleContent)
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect((doc!.content.match(/<!--media:/g) ?? []).length).toBe(1)
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
    expect(doc!.content).toContain(
      `[embed:video](https://youtube.com/embed/ID "Setup demo")<!--media:${video.imageId}-->`
    )
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
})
