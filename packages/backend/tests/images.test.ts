import { describe, expect, it, vi } from "vitest"
import { internal } from "../convex/_generated/api"
import { rankDocImagesForQuery } from "@tars-inc/eval-lib/multimodal"

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
    expect(after!.manualContext).toBe("the quarterly revenue keynote")
    expect(after!.embedding).toBeDefined()
    // hash reflects the manual-context blend (differs from the no-context hash)
    const { createHash } = await import("node:crypto")
    const noContextHash = createHash("sha256")
      .update("mock:A chart. Heading")
      .digest("hex")
    expect(after!.embeddingInputHash).not.toBe(noContextHash)
  })
})

describe("mediaType: doc_link excluded from ranking", () => {
  it("rankedImagesForDocs skips doc_link rows", async () => {
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
          embedding: [1, 0],
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
    const menu = await t.query(internal.kb.images.rankedImagesForDocs, {
      kbId,
      documentIds: [docId],
      queryEmbedding: [1, 0],
      cap: 6
    })
    expect(menu.map((m) => m.imageId)).toEqual(["img_i"]) // doc_link excluded
    expect(menu[0].type).toBe("image") // menu entries carry media type
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

  it("writes rows with embeddings, annotates content, skips decorative (E4)", async () => {
    const t = setupTest()
    const { kbId, docId } = await seedDoc(t, sampleContent)

    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows.length).toBe(1)
    expect(rows[0].alt).toBe("Quarterly revenue chart")
    expect(rows[0].embedding).toEqual([1, 0])

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
    const { kbId, docId } = await seedDoc(t, content)
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const rows = await t.run((ctx) =>
      ctx.db
        .query("kbMedia")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", docId))
        .collect()
    )
    const video = rows.find((r) => r.mediaType === "video")!
    const docLink = rows.find((r) => r.mediaType === "doc_link")!
    expect(video.embedding).toEqual([1, 0]) // video embedded
    expect(docLink.embedding).toBeUndefined() // doc_link not embedded

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

    const rows1 = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })

    // Re-run on identical content: no new embed call, embedding preserved.
    await t.action(internal.kb.images_actions.processDocImages, { docId })
    expect(embedState.calls).toBe(afterFirst)

    const rows2 = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: [docId]
    })
    expect(rows2[0].embedding).toEqual(rows1[0].embedding)
  })
})

describe("doc-gated menu (imagesForDocs + rankDocImagesForQuery)", () => {
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
        { imageId: "img_a1", url: "https://x/a1.png", alt: "a1", embedding: [1, 0] },
        { imageId: "img_a2", url: "https://x/a2.png", alt: "a2", embedding: [0.5, 0.5] }
      ]
    })
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId,
      orgId,
      sourceDocId: docB,
      images: [
        { imageId: "img_b1", url: "https://x/b1.png", alt: "b1", embedding: [0.9, 0.1] }
      ]
    })

    const docOrder = [docA, docB]
    const rows = await t.query(internal.kb.images.imagesForDocs, {
      kbId,
      documentIds: docOrder
    })
    const groups = docOrder.map((d) =>
      rows
        .filter((r) => r.documentId === d)
        .map((r) => ({ imageId: r.imageId, alt: r.alt, embedding: r.embedding }))
    )
    const menu = rankDocImagesForQuery([1, 0], groups, 6)
    // round-robin: docA #1, docB #1, docA #2
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_b1", "img_a2"])

    // DB-side ranking (rankedImagesForDocs) returns the same menu, only [{imageId, alt}].
    const dbMenu = await t.query(internal.kb.images.rankedImagesForDocs, {
      kbId,
      documentIds: docOrder,
      queryEmbedding: [1, 0],
      cap: 6
    })
    expect(dbMenu).toEqual([
      { imageId: "img_a1", alt: "a1", type: "image" },
      { imageId: "img_b1", alt: "b1", type: "image" },
      { imageId: "img_a2", alt: "a2", type: "image" }
    ])
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
