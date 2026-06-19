import { describe, expect, it } from "vitest"
import { imageIdFor } from "../convex/lib/vision"

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
