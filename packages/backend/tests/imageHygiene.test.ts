import { describe, expect, it } from "vitest"
import {
  type EvalInput,
  runImageHygiene
} from "../convex/conversationSim/evaluation"

function input(partial: Partial<EvalInput>): EvalInput {
  return { messages: [], toolCalls: [], ...partial }
}

describe("runImageHygiene", () => {
  it("passes neutrally when the run surfaced no images", () => {
    const r = runImageHygiene(
      {},
      input({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "Hello, how can I help?" }
        ]
      })
    )
    expect(r.passed).toBe(true)
    expect(r.justification).toMatch(/no images/i)
  })

  it("passes when rendered images are whitelisted and within the cap", () => {
    const r = runImageHygiene(
      {},
      input({
        messages: [
          {
            role: "assistant",
            content: "Here it is ![diagram](https://cdn.example.com/a.png)",
            shownImages: [
              {
                imageId: "img_abc123",
                url: "https://cdn.example.com/a.png",
                alt: "diagram"
              }
            ]
          }
        ]
      })
    )
    expect(r.passed).toBe(true)
  })

  it("fails when an unresolved KB media id marker leaks into output", () => {
    const r = runImageHygiene(
      {},
      input({
        messages: [
          {
            role: "assistant",
            content: "See ![diagram](img_abc1234567890abc)",
            shownImages: []
          }
        ],
        imageMenu: [{ imageId: "img_abc1234567890abc", alt: "diagram" }]
      })
    )
    expect(r.passed).toBe(false)
    expect(r.justification).toMatch(/img_abc1234567890abc/)
  })

  it("fails when a turn renders more images than the cap", () => {
    const shown = Array.from({ length: 3 }, (_, i) => ({
      imageId: `img_${i}`,
      url: `https://cdn.example.com/${i}.png`,
      alt: `img ${i}`
    }))
    const r = runImageHygiene(
      { maxImages: 2 },
      input({
        messages: [{ role: "assistant", content: "lots", shownImages: shown }]
      })
    )
    expect(r.passed).toBe(false)
    expect(r.justification).toMatch(/exceeds cap/)
  })

  it("falls back to counting markdown images when shownImages is absent", () => {
    const content =
      "![a](https://x/a.png) ![b](https://x/b.png) ![c](https://x/c.png)"
    const r = runImageHygiene(
      { maxImages: 2 },
      input({
        messages: [{ role: "assistant", content }],
        imageMenu: [{ imageId: "img_x", alt: "x" }]
      })
    )
    expect(r.passed).toBe(false)
    expect(r.justification).toMatch(/exceeds cap/)
  })
})
