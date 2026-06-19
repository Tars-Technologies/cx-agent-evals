import { describe, expect, it } from "vitest"
import { buildImageMenuFromChunks, imageIdFor } from "../convex/lib/vision"

describe("imageIdFor", () => {
  it("is deterministic and prefixed", () => {
    const a = imageIdFor("kb_1", "https://x.com/p.png")
    const b = imageIdFor("kb_1", "https://x.com/p.png")
    expect(a).toBe(b)
    expect(a.startsWith("img_")).toBe(true)
    expect(a.length).toBe(20) // "img_" + 16 hex
  })

  it("normalizes url (trailing slash, query order) before hashing", () => {
    expect(imageIdFor("kb_1", "https://x.com/a/?b=2&a=1")).toBe(
      imageIdFor("kb_1", "https://x.com/a?a=1&b=2")
    )
  })

  it("differs by kbId", () => {
    expect(imageIdFor("kb_1", "https://x.com/p.png")).not.toBe(
      imageIdFor("kb_2", "https://x.com/p.png")
    )
  })
})

describe("buildImageMenuFromChunks", () => {
  it("flattens + dedups metadata.images across chunks, first-seen order", () => {
    const chunks = [
      { metadata: { images: [{ imageId: "img_a", alt: "a" }] } },
      { metadata: {} },
      {
        metadata: {
          images: [
            { imageId: "img_b", alt: "b" },
            { imageId: "img_a", alt: "a" }
          ]
        }
      }
    ]
    expect(buildImageMenuFromChunks(chunks)).toEqual([
      { imageId: "img_a", alt: "a" },
      { imageId: "img_b", alt: "b" }
    ])
  })

  it("returns [] when no chunk has images", () => {
    expect(buildImageMenuFromChunks([{ metadata: {} }, {}])).toEqual([])
  })
})
