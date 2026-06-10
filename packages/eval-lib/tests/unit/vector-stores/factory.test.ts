import { describe, expect, it } from "vitest"
import { makeVectorStore } from "../../../src/vector-stores/factory.js"
import { InMemoryVectorStore } from "../../../src/vector-stores/in-memory.js"
import { QdrantVectorStore } from "../../../src/vector-stores/qdrant.js"

describe("makeVectorStore", () => {
  it("memory returns a fresh InMemoryVectorStore", () => {
    const a = makeVectorStore({ backend: "memory" })
    const b = makeVectorStore({ backend: "memory" })
    expect(a).toBeInstanceOf(InMemoryVectorStore)
    expect(a).not.toBe(b)
  })

  it("native requires hooks.native", () => {
    expect(() => makeVectorStore({ backend: "native" })).toThrow(
      'makeVectorStore: backend "native" requires hooks.native'
    )
  })

  it("native wraps the provided callbacks", async () => {
    const store = makeVectorStore(
      { backend: "native" },
      { native: { name: "convex-native", search: async () => [] } }
    )
    expect(store.name).toBe("convex-native")
    expect(await store.search([1], { k: 1 })).toEqual([])
  })

  it("qdrant builds a QdrantVectorStore from the config", () => {
    const store = makeVectorStore({
      backend: "qdrant",
      url: "http://localhost:6333",
      collection: "kb_x_hash",
      dimension: 1536
    })
    expect(store).toBeInstanceOf(QdrantVectorStore)
    expect(store.name).toBe("qdrant")
  })

  it("unknown backend throws", () => {
    expect(() =>
      // @ts-expect-error - runtime guard for untyped config sources
      makeVectorStore({ backend: "chroma" })
    ).toThrow("Unknown vector store backend: chroma")
  })
})
