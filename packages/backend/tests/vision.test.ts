import { describe, expect, it } from "vitest"
import {
  imageIdFor,
  isLikelyDecorativeImage,
  resolveAnswerImageMarkers
} from "../convex/lib/vision"

// The pure media-retrieval helpers (buildImageEmbeddingInput, rankDocImagesForQuery,
// isVisionCapable, whitelistImageMarkdown) moved to @tars-inc/eval-lib/multimodal;
// their unit tests live in eval-lib's tests/unit/multimodal.test.ts. This file
// covers only the node-only / Convex-coupled pieces that stayed in the backend.

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

  it("prefixes by media type (img_/vid_/doc_), same hash across types", () => {
    const u = "https://x.com/p"
    expect(imageIdFor("kb_1", u, "image").startsWith("img_")).toBe(true)
    expect(imageIdFor("kb_1", u, "video").startsWith("vid_")).toBe(true)
    expect(imageIdFor("kb_1", u, "doc_link").startsWith("doc_")).toBe(true)
    // same 16-hex suffix, only the prefix differs
    expect(imageIdFor("kb_1", u, "image").slice(4)).toBe(
      imageIdFor("kb_1", u, "video").slice(4)
    )
  })
})

describe("isLikelyDecorativeImage", () => {
  it("flags tiny rendered thumbnails (icons, flags, location pins)", () => {
    expect(
      isLikelyDecorativeImage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Red_pog.svg/12px-Red_pog.svg.png"
      )
    ).toBe(true)
    expect(
      isLikelyDecorativeImage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag.svg/23px-Flag.svg.png"
      )
    ).toBe(true)
  })
  it("flags known decorative filenames", () => {
    expect(
      isLikelyDecorativeImage("https://x.org/thumb/Commons-logo.svg.png")
    ).toBe(true)
  })
  it("flags decorative path segments (/icons/, /logos/, …)", () => {
    expect(isLikelyDecorativeImage("https://x.com/assets/icons/cart.png")).toBe(
      true
    )
    expect(isLikelyDecorativeImage("https://x.com/logos/brand.png")).toBe(true)
    expect(isLikelyDecorativeImage("https://x.com/avatars/u123.png")).toBe(true)
  })
  it("flags small width/height query params", () => {
    expect(isLikelyDecorativeImage("https://x.com/i.png?w=32")).toBe(true)
    expect(isLikelyDecorativeImage("https://x.com/i.png?width=48&h=48")).toBe(
      true
    )
  })
  it("flags generic chrome filenames (favicon/sprite/spacer/1x1)", () => {
    expect(isLikelyDecorativeImage("https://x.com/favicon.ico")).toBe(true)
    expect(isLikelyDecorativeImage("https://x.com/ui-sprite.png")).toBe(true)
    expect(isLikelyDecorativeImage("https://x.com/1x1.gif")).toBe(true)
  })
  it("keeps real content images", () => {
    expect(
      isLikelyDecorativeImage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/x/y/440px-Eiffel_Tower.jpg"
      )
    ).toBe(false)
    expect(isLikelyDecorativeImage("https://x.com/photo.jpg")).toBe(false)
    // "/thumb/" must NOT be treated as decorative (MediaWiki content path).
    expect(
      isLikelyDecorativeImage("https://x.com/thumb/a/b/800px-Skyline.jpg")
    ).toBe(false)
    // Large explicit dimensions in query params are content, not chrome.
    expect(isLikelyDecorativeImage("https://x.com/hero.jpg?w=1200")).toBe(false)
  })
})

describe("resolveAnswerImageMarkers", () => {
  it("keeps seed and resolves inline markers via the registry; ignores unknowns", async () => {
    const seed = new Map([
      ["img_seed", { url: "https://x.com/seed.png", alt: "s" }]
    ])
    const ctx = {
      runQuery: async (_ref: unknown, args: { imageIds: string[] }) =>
        args.imageIds
          .filter((id) => id === "img_aaaaaaaaaaaaaaaa")
          .map((id) => ({ imageId: id, url: "https://x.com/a.png", alt: "a" }))
    } as any
    const text =
      "see ![a](img_aaaaaaaaaaaaaaaa) and ![s](img_seed) and ![bad](img_ffffffffffffffff)"
    const resolved = await resolveAnswerImageMarkers(
      ctx,
      { kbIds: ["kb1"] as any, orgId: "o1" },
      text,
      seed
    )
    expect(resolved.get("img_aaaaaaaaaaaaaaaa")).toEqual({
      url: "https://x.com/a.png",
      alt: "a"
    })
    expect(resolved.get("img_seed")).toEqual({
      url: "https://x.com/seed.png",
      alt: "s"
    })
    expect(resolved.has("img_ffffffffffffffff")).toBe(false)
  })

  it("makes no query when every marker is already seeded", async () => {
    let called = false
    const ctx = {
      runQuery: async () => {
        called = true
        return []
      }
    } as any
    const seed = new Map([["img_seed", { url: "https://x.com/s.png", alt: "s" }]])
    await resolveAnswerImageMarkers(
      ctx,
      { kbIds: ["kb1"] as any, orgId: "o1" },
      "![s](img_seed)",
      seed
    )
    expect(called).toBe(false)
  })
})
