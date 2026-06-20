import { describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import { extractChunkImages } from "../convex/kb/indexing_actions"
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
