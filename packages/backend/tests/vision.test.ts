import type { MarkdownImage } from "@tars-inc/eval-lib/file-processing/markdown-images"
import { describe, expect, it } from "vitest"
import {
  imageIdFor,
  isLikelyDecorativeImage,
  resolveAnswerImageMarkers
} from "../convex/lib/vision"
import {
  buildImageEmbeddingInput,
  isVisionCapable,
  MAX_IMAGES_PER_TURN,
  MENU_IMAGE_CAP,
  rankDocImagesForQuery,
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

describe("buildImageEmbeddingInput", () => {
  const img = (alt: string, content: string): MarkdownImage => ({
    alt,
    url: "https://x/i.png",
    raw: `![${alt}](https://x/i.png)`,
    index: content.indexOf("![")
  })

  it("strong alt → no surrounding text", () => {
    const content = `## Pricing tiers\n![Comparison of pricing plans](https://x/i.png)\nbody text here`
    const r = buildImageEmbeddingInput(
      content,
      img("Comparison of pricing plans", content)
    )
    expect(r.usedSurrounding).toBe(false)
    expect(r.input).toContain("Comparison of pricing plans")
    expect(r.input).toContain("Pricing tiers")
  })

  it("empty alt → placeholder and all-weak → surrounding included", () => {
    const content = `## More\n![](https://x/i.png)\nthe quick brown fox jumps`
    const r = buildImageEmbeddingInput(content, img("", content))
    expect(r.alt).toBe("image")
    expect(r.usedSurrounding).toBe(true)
    expect(r.input).toContain("quick brown fox")
  })

  it("weak alt + strong italic caption → no surrounding", () => {
    const content = `## x\n![logo](https://x/i.png)\n*Figure 2: the revenue dashboard*\nmore`
    const r = buildImageEmbeddingInput(content, img("logo", content))
    expect(r.usedSurrounding).toBe(false)
    expect(r.input).toContain("revenue dashboard")
  })

  it("manual context dominates the embedding input (highest priority)", () => {
    const content = `## Pricing tiers\n![Comparison of pricing plans](https://x/i.png)\nbody text here`
    const r = buildImageEmbeddingInput(
      content,
      img("Comparison of pricing plans", content),
      "the CEO on stage at the 2024 launch keynote"
    )
    expect(r.input).toBe("the CEO on stage at the 2024 launch keynote")
    expect(r.usedSurrounding).toBe(false)
    // scraped signals are NOT mixed in when manual context is present
    expect(r.input).not.toContain("Pricing tiers")
    expect(r.input).not.toContain("Comparison of pricing plans")
  })

  it("blank manual context falls back to the scraped signals", () => {
    const content = `## Pricing tiers\n![Comparison of pricing plans](https://x/i.png)\nbody`
    const r = buildImageEmbeddingInput(
      content,
      img("Comparison of pricing plans", content),
      "   "
    )
    expect(r.input).toContain("Comparison of pricing plans")
  })
})

describe("rankDocImagesForQuery", () => {
  const q = [1, 0]
  // cos(q, [1,0]) = 1 ; cos(q, [0.1,1]) ≈ 0.0995 (< MIN_IMAGE_SIMILARITY)

  it("drops images below the relevance threshold (B4)", () => {
    const docA = [
      { imageId: "img_good", alt: "g", embedding: [1, 0] },
      { imageId: "img_bad", alt: "b", embedding: [0.1, 1] }
    ]
    const menu = rankDocImagesForQuery(q, [docA], 6)
    expect(menu.map((m) => m.imageId)).toEqual(["img_good"])
  })

  it("returns an empty menu when every candidate is below threshold", () => {
    const docA = [{ imageId: "img_bad", alt: "b", embedding: [0.1, 1] }]
    expect(rankDocImagesForQuery(q, [docA], 6)).toEqual([])
  })

  it("caps per document when the pool spans multiple docs (B5)", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1", embedding: [1, 0] },
      { imageId: "img_a2", alt: "a2", embedding: [0.99, 0.01] },
      { imageId: "img_a3", alt: "a3", embedding: [0.98, 0.02] }
    ]
    const docB = [{ imageId: "img_b1", alt: "b1", embedding: [0.9, 0.1] }]
    const menu = rankDocImagesForQuery(q, [docA, docB], 6)
    // docA capped at PER_DOC_IMAGE_CAP (2); a3 drops out, b1 fills the slot
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_a2", "img_b1"])
  })

  it("does NOT cap a single-document pool (option b)", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1", embedding: [1, 0] },
      { imageId: "img_a2", alt: "a2", embedding: [0.99, 0.01] },
      { imageId: "img_a3", alt: "a3", embedding: [0.98, 0.02] }
    ]
    const menu = rankDocImagesForQuery(q, [docA], 6)
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_a2", "img_a3"])
  })

  it("ranks globally by cosine, not by document order", () => {
    // docA ranks first by chunk order but holds a weak image; docB's is stronger.
    const docA = [{ imageId: "img_a1", alt: "a1", embedding: [0.5, 1] }] // ≈0.447
    const docB = [{ imageId: "img_b1", alt: "b1", embedding: [1, 0.1] }] // ≈0.995
    const menu = rankDocImagesForQuery(q, [docA, docB], 6)
    expect(menu.map((m) => m.imageId)).toEqual(["img_b1", "img_a1"])
  })

  it("dedups a shared imageId across docs (first occurrence wins)", () => {
    const docA = [{ imageId: "img_x", alt: "x", embedding: [1, 0] }]
    const docB = [{ imageId: "img_x", alt: "x", embedding: [1, 0] }]
    expect(rankDocImagesForQuery(q, [docA, docB], 6).map((m) => m.imageId)).toEqual(
      ["img_x"]
    )
  })

  it("falls back to doc-order (cap, no threshold) when no embedding is usable", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1" },
      { imageId: "img_a2", alt: "a2" },
      { imageId: "img_a3", alt: "a3" }
    ]
    const docB = [{ imageId: "img_b1", alt: "b1" }]
    const menu = rankDocImagesForQuery(q, [docA, docB], 6)
    // doc order, per-doc cap applies (multi-doc): a3 drops
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_a2", "img_b1"])
  })

  it("drops unscored images when a usable one exists (mixed pool)", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1", embedding: [1, 0] },
      { imageId: "img_a2", alt: "a2" } // no embedding → dropped
    ]
    expect(rankDocImagesForQuery(q, [docA], 6).map((m) => m.imageId)).toEqual([
      "img_a1"
    ])
  })

  it("caps at MENU_IMAGE_CAP", () => {
    const groups = Array.from({ length: 10 }, (_, i) => [
      { imageId: `img_${i}`, alt: `${i}`, embedding: [1 - i / 100, 0] }
    ])
    expect(rankDocImagesForQuery(q, groups, MENU_IMAGE_CAP).length).toBe(
      MENU_IMAGE_CAP
    )
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
  it("resolves a known doc-id link but leaves real hyperlinks untouched", () => {
    const map = new Map([["img_d", { url: "https://x.com/s.pdf", alt: "Spec" }]])
    const text = "see [Spec](img_d) and [our blog](https://blog.com/post)"
    expect(whitelistImageMarkdown(text, map)).toBe(
      "see [Spec](https://x.com/s.pdf) and [our blog](https://blog.com/post)"
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
  it("keeps real content images", () => {
    expect(
      isLikelyDecorativeImage(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/x/y/440px-Eiffel_Tower.jpg"
      )
    ).toBe(false)
    expect(isLikelyDecorativeImage("https://x.com/photo.jpg")).toBe(false)
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
