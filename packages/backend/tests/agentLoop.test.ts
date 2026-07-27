import { beforeEach, describe, expect, it, vi } from "vitest"

// finalizeMediaAnswer's corrective retry calls generateText — mock the AI SDK
// so we can inspect exactly what message shape it sends, without a real model.
const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  tool: (def: unknown) => def
}))
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (modelId: string) => ({ modelId, provider: "anthropic" })
}))
vi.mock("@ai-sdk/openai", () => ({
  openai: (modelId: string) => ({ modelId, provider: "openai" })
}))

import { finalizeMediaAnswer } from "../convex/lib/agentLoop"

beforeEach(() => {
  generateTextMock.mockReset()
})

describe("finalizeMediaAnswer — corrective retry", () => {
  it("sends the correction as a trailing user message, not appended to system with a trailing assistant message (AI SDK prefill bug)", async () => {
    // If the last message were { role: "assistant" }, the AI SDK treats it as a
    // prefill and the model just continues that text instead of rewriting it —
    // the whole point of the corrective retry would silently do nothing.
    generateTextMock.mockResolvedValueOnce({
      text: "![chart](img_aaaaaaaaaaaaaaaa)"
    })
    const ctx = {
      runQuery: async (_ref: unknown, args: { imageIds: string[] }) =>
        args.imageIds
          .filter((id) => id === "img_aaaaaaaaaaaaaaaa")
          .map((id) => ({
            imageId: id,
            url: "https://x.com/a.png",
            alt: "chart"
          }))
    } as any

    const result = await finalizeMediaAnswer(ctx, {
      rawText: "here: ![chart](https://evil.com/fake.png)",
      aiMessages: [{ role: "user", content: "show me the chart" }],
      systemPrompt: "SYS",
      modelId: "claude-haiku-4-5-20251001",
      hasVision: true,
      imageScope: { kbIds: ["kb1"], orgId: "o1" },
      resolvedImages: new Map(),
      lastImageMenu: new Map([
        [
          "img_aaaaaaaaaaaaaaaa",
          { imageId: "img_aaaaaaaaaaaaaaaa", alt: "chart" }
        ]
      ])
    })

    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const call = generateTextMock.mock.calls[0][0] as {
      system: string
      messages: Array<{ role: string; content: string }>
    }
    // The instruction must NOT be appended to system — it must be a fresh
    // trailing user turn.
    expect(call.system).toBe("SYS")
    const last = call.messages[call.messages.length - 1]
    const secondToLast = call.messages[call.messages.length - 2]
    expect(last.role).toBe("user")
    expect(last.content).toContain("does not exist")
    expect(secondToLast).toEqual({
      role: "assistant",
      content: "here: ![chart](https://evil.com/fake.png)"
    })

    expect(result.finalText).toContain("https://x.com/a.png")
    expect(result.shownImages.map((i) => i.imageId)).toEqual([
      "img_aaaaaaaaaaaaaaaa"
    ])
  })

  it("does not call generateText when the answer references no fabricated target", async () => {
    const ctx = { runQuery: async () => [] } as any
    const result = await finalizeMediaAnswer(ctx, {
      rawText: "plain text, no media reference",
      aiMessages: [],
      systemPrompt: "SYS",
      modelId: "claude-haiku-4-5-20251001",
      hasVision: false,
      resolvedImages: new Map(),
      lastImageMenu: new Map()
    })
    expect(generateTextMock).not.toHaveBeenCalled()
    expect(result.finalText).toBe("plain text, no media reference")
  })

  it("backstops a fabricated reference even if no menu was ever offered (no retry possible)", async () => {
    const ctx = { runQuery: async () => [] } as any
    const result = await finalizeMediaAnswer(ctx, {
      rawText: "here: ![chart](https://evil.com/fake.png)",
      aiMessages: [],
      systemPrompt: "SYS",
      modelId: "claude-haiku-4-5-20251001",
      hasVision: false,
      resolvedImages: new Map(),
      lastImageMenu: new Map() // empty — retry can't run, only the backstop can act
    })
    expect(generateTextMock).not.toHaveBeenCalled()
    expect(result.finalText).not.toContain("evil.com")
  })
})
