import { describe, expect, it } from "vitest"
import { internal } from "../convex/_generated/api"
import { extractChunkImages } from "../convex/kb/indexing_actions"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

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
