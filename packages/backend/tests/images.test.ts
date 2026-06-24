import { describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import { extractChunkImages } from "../convex/lib/vision"
import {
  seedDataset,
  seedKB,
  seedUser,
  setupTest,
  TEST_ORG_ID
} from "./helpers"

describe("extractChunkImages", () => {
  it("rewrites chunk markdown and lists images", () => {
    const { content, images } = extractChunkImages(
      "kb_1",
      "see ![cat](https://x.com/c.png) here"
    )
    expect(images.length).toBe(1)
    expect(content).toBe(`see ![cat](${images[0].imageId}) here`)
    expect(images[0].imageId.startsWith("img_")).toBe(true)
  })

  it("leaves chunks without images untouched", () => {
    const { content, images } = extractChunkImages("kb_1", "no images here")
    expect(images).toEqual([])
    expect(content).toBe("no images here")
  })
})

describe("kb.images.upsertImagesForChunk", () => {
  it("inserts images idempotently keyed by (kbId, imageId)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run(async (ctx) =>
      ctx.db.insert("documents", {
        orgId,
        kbId,
        docId: "d1",
        title: "t",
        content: "c",
        contentLength: 1,
        metadata: {},
        createdAt: Date.now()
      })
    )

    const images = [
      { imageId: "img_aaaa", url: "https://x.com/a.png", alt: "a" },
      { imageId: "img_bbbb", url: "https://x.com/b.png", alt: "b" }
    ]
    await t.mutation(internal.kb.images.upsertImagesForChunk, {
      kbId,
      orgId,
      sourceDocId: docId,
      images
    })
    // second call with an overlapping id must not duplicate
    await t.mutation(internal.kb.images.upsertImagesForChunk, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [{ imageId: "img_aaaa", url: "https://x.com/a.png", alt: "a" }]
    })

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("kbImages")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(rows.length).toBe(2)
    expect(rows.map((r) => r.imageId).sort()).toEqual(["img_aaaa", "img_bbbb"])
  })
})

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
        { imageId: "img_a", url: "https://x/a.png", alt: "a", embedding: [1, 0] },
        { imageId: "img_b", url: "https://x/b.png", alt: "b" }
      ]
    })
    let rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.map((r) => r.imageId).sort()).toEqual(["img_a", "img_b"])

    // Re-run without img_b → it must be deleted (E2); img_a alt/embedding updated.
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docId,
      images: [
        { imageId: "img_a", url: "https://x/a.png", alt: "a2", embedding: [0, 1] }
      ]
    })
    rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.map((r) => r.imageId)).toEqual(["img_a"])
    expect(rows[0].alt).toBe("a2")
    expect(rows[0].embedding).toEqual([0, 1])
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

describe("backfillImagesForKb", () => {
  it("backfills images and is idempotent", async () => {
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
        createdAt: Date.now()
      })
    )
    const chunkId = await t.run((ctx) =>
      ctx.db.insert("documentChunks", {
        documentId: docId,
        kbId,
        chunkId: "c1",
        content: "x ![cat](https://x.com/c.png) y",
        start: 0,
        end: 5,
        metadata: {}
      })
    )

    await t.action(internal.kb.images_actions.backfillImagesForKb, {
      kbId,
      orgId
    })

    const after = await t.run((ctx) => ctx.db.get(chunkId))
    expect(after!.content).toMatch(/!\[cat\]\(img_[0-9a-f]{16}\)/)
    expect(after!.metadata.images.length).toBe(1)
    const kbImageRows = await t.run((ctx) =>
      ctx.db
        .query("kbImages")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(kbImageRows.length).toBe(1)

    // Second run is a no-op (good img_ marker resolves to a kept url).
    const contentAfter1 = after!.content
    await t.action(internal.kb.images_actions.backfillImagesForKb, {
      kbId,
      orgId
    })
    const after2 = await t.run((ctx) => ctx.db.get(chunkId))
    expect(after2!.content).toBe(contentAfter1)
  })

  it("re-cleans an already-rewritten decorative marker", async () => {
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
        createdAt: Date.now()
      })
    )
    // Two pre-existing markers: a decorative pin and a real photo.
    const pinUrl =
      "https://upload.wikimedia.org/x/thumb/y/12px-Red_pog.svg.png"
    const photoUrl = "https://x.com/skyline.jpg"
    await t.run(async (ctx) => {
      await ctx.db.insert("kbImages", {
        imageId: "img_pin",
        kbId,
        orgId,
        url: pinUrl,
        alt: "pin",
        sourceDocId: docId,
        createdAt: Date.now()
      })
      await ctx.db.insert("kbImages", {
        imageId: "img_photo",
        kbId,
        orgId,
        url: photoUrl,
        alt: "view",
        sourceDocId: docId,
        createdAt: Date.now()
      })
    })
    const chunkId = await t.run((ctx) =>
      ctx.db.insert("documentChunks", {
        documentId: docId,
        kbId,
        chunkId: "c1",
        content: "City ![pin](img_pin) and ![view](img_photo)",
        start: 0,
        end: 5,
        metadata: {
          images: [
            { imageId: "img_pin", alt: "pin" },
            { imageId: "img_photo", alt: "view" }
          ]
        }
      })
    )

    const res = await t.action(
      internal.kb.images_actions.backfillImagesForKb,
      { kbId, orgId }
    )
    expect(res.dropped).toBe(1)

    const after = await t.run((ctx) => ctx.db.get(chunkId))
    expect(after!.content).toBe("City  and ![view](img_photo)")
    expect(after!.metadata.images).toEqual([{ imageId: "img_photo", alt: "view" }])
    // Decorative registry row removed; real one kept.
    const remaining = await t.run((ctx) =>
      ctx.db
        .query("kbImages")
        .withIndex("by_kb", (q) => q.eq("kbId", kbId))
        .collect()
    )
    expect(remaining.map((r) => r.imageId).sort()).toEqual(["img_photo"])
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
      await ctx.db.insert("kbImages", {
        imageId: "img_one",
        kbId: kb1,
        orgId,
        url: "https://x.com/1.png",
        alt: "one",
        sourceDocId: docId,
        createdAt: Date.now()
      })
      await ctx.db.insert("kbImages", {
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
