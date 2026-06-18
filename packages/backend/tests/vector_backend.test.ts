import { describe, expect, it } from "vitest"
import {
  assertEmbeddingBackendCompatible,
  qdrantCollectionName,
  qdrantCollectionNameFor,
  resolveVectorBackend
} from "../convex/kb/vector_backend"

describe("resolveVectorBackend", () => {
  it("returns qdrant only for the exact 'qdrant' value", () => {
    expect(resolveVectorBackend("qdrant")).toBe("qdrant")
  })

  it("defaults everything else to native", () => {
    expect(resolveVectorBackend("native")).toBe("native")
    expect(resolveVectorBackend(undefined)).toBe("native")
    expect(resolveVectorBackend(null)).toBe("native")
    expect(resolveVectorBackend("")).toBe("native")
    expect(resolveVectorBackend("Qdrant")).toBe("native")
    expect(resolveVectorBackend(42)).toBe("native")
  })
})

describe("qdrantCollectionName", () => {
  it("builds kb_vec_<provider>_<model>", () => {
    expect(qdrantCollectionName("openai", "text-embedding-3-small")).toBe(
      "kb_vec_openai_text-embedding-3-small"
    )
  })

  it("sanitizes characters outside [A-Za-z0-9_-]", () => {
    expect(qdrantCollectionName("cohere", "embed-english-v3.0")).toBe(
      "kb_vec_cohere_embed-english-v3_0"
    )
  })

  it("is deterministic for the same inputs", () => {
    expect(qdrantCollectionName("openai", "text-embedding-3-small")).toBe(
      qdrantCollectionName("openai", "text-embedding-3-small")
    )
  })
})

describe("qdrantCollectionNameFor", () => {
  it("reads provider/model from the index config", () => {
    expect(
      qdrantCollectionNameFor({
        embeddingProvider: "cohere",
        embeddingModel: "embed-english-v3.0"
      })
    ).toBe("kb_vec_cohere_embed-english-v3_0")
  })

  it("falls back to the (openai, text-embedding-3-small) defaults", () => {
    // An index config with no embedding fields, and one with them omitted,
    // must both resolve to the same default-keyed collection.
    expect(qdrantCollectionNameFor({})).toBe(
      "kb_vec_openai_text-embedding-3-small"
    )
    expect(qdrantCollectionNameFor({ strategy: "plain" })).toBe(
      qdrantCollectionNameFor({})
    )
  })

  it("matches qdrantCollectionName with the same resolved identity", () => {
    // Index time and retrieve time call this helper with the same config, so
    // the single source of truth must equal the raw namer for that identity.
    expect(qdrantCollectionNameFor({})).toBe(
      qdrantCollectionName("openai", "text-embedding-3-small")
    )
  })
})

describe("assertEmbeddingBackendCompatible", () => {
  it("rejects the native backend with a non-OpenAI provider", () => {
    expect(() => assertEmbeddingBackendCompatible("native", "cohere")).toThrow(
      /native vector backend supports only.*openai/i
    )
  })

  it("allows the native backend with openai or no provider", () => {
    expect(() =>
      assertEmbeddingBackendCompatible("native", "openai")
    ).not.toThrow()
    expect(() =>
      assertEmbeddingBackendCompatible("native", undefined)
    ).not.toThrow()
  })

  it("allows any provider on the qdrant backend", () => {
    expect(() =>
      assertEmbeddingBackendCompatible("qdrant", "cohere")
    ).not.toThrow()
    expect(() =>
      assertEmbeddingBackendCompatible("qdrant", "openrouter")
    ).not.toThrow()
  })
})
