import { describe, expect, it } from "vitest"
import {
  isUnsupportedImageUrl,
  parseMarkdownImages,
  rewriteMarkdownImages
} from "../../../src/file-processing/markdown-images.js"

describe("parseMarkdownImages", () => {
  it("extracts complete markdown images", () => {
    const md =
      "intro ![a cat](https://x.com/c.png) and ![dog](https://x.com/d.jpg) end"
    const imgs = parseMarkdownImages(md)
    expect(imgs.map((i) => ({ alt: i.alt, url: i.url }))).toEqual([
      { alt: "a cat", url: "https://x.com/c.png" },
      { alt: "dog", url: "https://x.com/d.jpg" }
    ])
  })

  it("skips SVG and data-uri targets", () => {
    const md =
      "![icon](https://x.com/i.svg) ![inline](data:image/png;base64,AAA) ![ok](https://x.com/p.png)"
    expect(parseMarkdownImages(md).map((i) => i.url)).toEqual([
      "https://x.com/p.png"
    ])
  })

  it("skips partial/boundary-split syntax", () => {
    const md = "tail of ![broken](https://x.com/p.pn" // no closing paren
    expect(parseMarkdownImages(md)).toEqual([])
  })

  it("skips relative urls (treated unsupported after non-resolution)", () => {
    const md = "![rel](/img/x.png)"
    // relative is non-http → unsupported, excluded from the parsed menu
    expect(parseMarkdownImages(md)).toEqual([])
  })

  // Accepted simplifications of IMAGE_RE (documented so a future change is caught).
  it("does not parse an image whose alt text contains a closing bracket", () => {
    // The alt group is [^\]]*, so a `]` inside the alt ends the match early and
    // the whole image fails to parse rather than mis-parsing.
    expect(parseMarkdownImages("![a [b] c](https://x.com/p.png)")).toEqual([])
  })

  it("truncates a url at the first close paren (parenthesized filenames)", () => {
    // The url group is [^)\s]+, so a `)` inside the url ends it early — e.g. a
    // Wikipedia-style parenthesized filename is captured only up to the paren.
    const imgs = parseMarkdownImages("![x](https://x.com/a(b).png)")
    expect(imgs.map((i) => i.url)).toEqual(["https://x.com/a(b"])
  })
})

describe("rewriteMarkdownImages", () => {
  it("rewrites targets returned by map", () => {
    const md = "see ![cat](https://x.com/c.png)!"
    const out = rewriteMarkdownImages(md, (i) =>
      i.url === "https://x.com/c.png" ? "img_abc" : null
    )
    expect(out).toBe("see ![cat](img_abc)!")
  })

  it("drops images whose map returns null", () => {
    const md = "a ![evil](https://evil.com/x.png) b"
    expect(rewriteMarkdownImages(md, () => null)).toBe("a  b")
  })
})

describe("isUnsupportedImageUrl", () => {
  it("flags data, svg, non-http", () => {
    expect(isUnsupportedImageUrl("data:image/png;base64,AA")).toBe(true)
    expect(isUnsupportedImageUrl("https://x.com/a.svg")).toBe(true)
    expect(isUnsupportedImageUrl("ftp://x.com/a.png")).toBe(true)
    expect(isUnsupportedImageUrl("/rel/a.png")).toBe(true)
    expect(isUnsupportedImageUrl("https://x.com/a.png")).toBe(false)
  })
})
