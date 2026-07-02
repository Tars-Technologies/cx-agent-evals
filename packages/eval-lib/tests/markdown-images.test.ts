import { describe, expect, it } from "vitest"
import {
  parseMarkdownMedia,
  stripImageComments,
  stripImageMarkdown,
  stripMediaMarkdown
} from "../src/file-processing/markdown-images.js"

describe("parseMarkdownMedia", () => {
  it("parses image, video, and doc tokens with types, in order", () => {
    const md =
      'a ![cat](https://x/c.png) b [embed:video](https://youtube.com/embed/ID "Demo") c [embed:doc](https://x/s.pdf "Spec")'
    const out = parseMarkdownMedia(md)
    expect(out.map((m) => [m.type, m.alt, m.url])).toEqual([
      ["image", "cat", "https://x/c.png"],
      ["video", "Demo", "https://youtube.com/embed/ID"],
      ["doc_link", "Spec", "https://x/s.pdf"]
    ])
  })
  it("skips unsupported image targets (data/svg) as before", () => {
    expect(parseMarkdownMedia("![x](data:foo) ![y](https://a/b.svg)")).toEqual([])
  })
  it("handles embed tokens without a title", () => {
    const out = parseMarkdownMedia("[embed:video](https://y/e)")
    expect(out).toEqual([
      {
        type: "video",
        alt: "",
        url: "https://y/e",
        raw: "[embed:video](https://y/e)",
        index: 0
      }
    ])
  })
})

describe("stripMediaMarkdown", () => {
  it("removes image + video tokens and media comments, keeps doc/plain links", () => {
    const md =
      'i ![c](https://x/c.png)<!--media:img_a--> v [embed:video](https://y/e "T") d [Spec](img_doc1) k'
    expect(stripMediaMarkdown(md)).toBe("i  v  d [Spec](img_doc1) k")
  })
  it("also strips legacy <!--img--> comments", () => {
    expect(stripMediaMarkdown("x<!--img:img_a--> y")).toBe("x y")
  })
})

describe("stripImageComments", () => {
  it("removes img annotation comments only", () => {
    const input = "a ![cat](https://x/c.png)<!--img:img_abc123--> b"
    expect(stripImageComments(input)).toBe("a ![cat](https://x/c.png) b")
  })
  it("leaves non-img comments untouched", () => {
    expect(stripImageComments("x <!-- keep --> y")).toBe("x <!-- keep --> y")
  })
})

describe("stripImageMarkdown", () => {
  it("removes images and their annotations", () => {
    const input = "see ![cat](https://x/c.png)<!--img:img_abc123--> here"
    expect(stripImageMarkdown(input)).toBe("see  here")
  })
  it("removes images that have no annotation", () => {
    expect(stripImageMarkdown("a ![x](https://y/z.png) b")).toBe("a  b")
  })
  it("is a no-op on plain text", () => {
    expect(stripImageMarkdown("no images")).toBe("no images")
  })
})
