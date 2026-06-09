import { describe, expect, it } from "vitest"
import { EMBEDDER_REGISTRY } from "../../../src/registry/embedders.js"

describe("EMBEDDER_REGISTRY", () => {
  it("contains the expected providers", () => {
    const ids = EMBEDDER_REGISTRY.map((e) => e.id)
    expect(ids).toEqual(["openai", "openrouter", "cohere", "voyage", "jina"])
  })

  it("all entries have required fields and a valid status", () => {
    for (const entry of EMBEDDER_REGISTRY) {
      expect(entry.name).toBeTruthy()
      expect(entry.description).toBeTruthy()
      expect(entry.status).toMatch(/^(available|coming-soon|unavailable)$/)
      expect(entry.options.length).toBeGreaterThan(0)
      for (const opt of entry.options) {
        expect(entry.defaults).toHaveProperty(opt.key)
      }
    }
  })

  it("openai has correct models and is available", () => {
    const openai = EMBEDDER_REGISTRY.find((e) => e.id === "openai")!
    expect(openai.status).toBe("available")
    const values = openai.options
      .find((o) => o.key === "model")!
      .choices!.map((c) => c.value)
    expect(values).toContain("text-embedding-3-small")
    expect(values).toContain("text-embedding-3-large")
  })

  it("openrouter is available", () => {
    const openrouter = EMBEDDER_REGISTRY.find((e) => e.id === "openrouter")!
    expect(openrouter.status).toBe("available")
  })

  it("providers wired into makeEmbedder are available; others are unavailable", () => {
    const status = (id: string) =>
      EMBEDDER_REGISTRY.find((e) => e.id === id)!.status
    expect(status("openai")).toBe("available")
    expect(status("openrouter")).toBe("available")
    expect(status("cohere")).toBe("available")
    expect(status("voyage")).toBe("unavailable")
    expect(status("jina")).toBe("unavailable")
  })
})
