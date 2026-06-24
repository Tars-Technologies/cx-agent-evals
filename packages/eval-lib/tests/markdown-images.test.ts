import { describe, expect, it } from "vitest"
import {
  stripImageComments,
  stripImageMarkdown
} from "../src/file-processing/markdown-images.js"

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
