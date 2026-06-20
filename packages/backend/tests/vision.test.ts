import { describe, expect, it } from "vitest"
import {
  extractChunkImages,
  imageIdFor,
  isLikelyDecorativeImage,
  resolveAnswerImageMarkers
} from "../convex/lib/vision"
import {
  buildImageMenuFromChunks,
  isVisionCapable,
  MAX_IMAGES_PER_TURN,
  VISION_CAPABLE_MODELS,
  whitelistImageMarkdown
} from "../convex/lib/visionShared"

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

describe("isVisionCapable", () => {
  it("accepts known vision models", () => {
    expect(isVisionCapable("claude-opus-4-8")).toBe(true)
    expect(isVisionCapable("claude-sonnet-4-6")).toBe(true)
    expect(isVisionCapable("gpt-4o")).toBe(true)
  })
  it("accepts every model the agent dropdown offers", () => {
    // Keep in sync with AgentConfigPanel.tsx model <option> values.
    for (const m of [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o4-mini",
      "gpt-4o"
    ]) {
      expect(isVisionCapable(m)).toBe(true)
    }
  })
  it("rejects unknown / non-vision models", () => {
    expect(isVisionCapable("o1-mini")).toBe(false)
    expect(isVisionCapable("some-future-model")).toBe(false)
  })
  it("caps images per turn at 4", () => {
    expect(MAX_IMAGES_PER_TURN).toBe(4)
    expect(VISION_CAPABLE_MODELS.length).toBeGreaterThan(0)
  })
})

describe("whitelistImageMarkdown", () => {
  const resolved = new Map([
    ["img_a", { url: "https://x.com/a.png", alt: "a" }]
  ])

  it("rewrites known imageId markers to real urls", () => {
    expect(whitelistImageMarkdown("see ![a](img_a)", resolved)).toBe(
      "see ![a](https://x.com/a.png)"
    )
  })
  it("drops unknown imageIds", () => {
    expect(whitelistImageMarkdown("x ![h](img_hallucinated) y", resolved)).toBe(
      "x  y"
    )
  })
  it("drops raw external image urls (injection guard)", () => {
    expect(
      whitelistImageMarkdown("a ![e](https://evil.com/x.png) b", resolved)
    ).toBe("a  b")
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
  it("keeps real content images", () => {
    expect(
      isLikelyDecorativeImage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/x/y/440px-Eiffel_Tower.jpg"
      )
    ).toBe(false)
    expect(isLikelyDecorativeImage("https://x.com/photo.jpg")).toBe(false)
  })
})

describe("extractChunkImages decorative filtering", () => {
  it("drops a location pin but keeps the real photo", () => {
    const md =
      "City ![pin](https://upload.wikimedia.org/x/thumb/y/12px-Red_pog.svg.png) and ![view](https://x.com/skyline.jpg)"
    const { content, images } = extractChunkImages("kb_1", md)
    expect(images.map((i) => i.url)).toEqual(["https://x.com/skyline.jpg"])
    expect(content).toContain("![view](img_")
    expect(content).not.toContain("Red_pog")
    expect(content).not.toContain("![pin]")
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
      { kbId: "kb1" as any, orgId: "o1" },
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
      { kbId: "kb1" as any, orgId: "o1" },
      "![s](img_seed)",
      seed
    )
    expect(called).toBe(false)
  })
})
