import { describe, expect, it } from "vitest"
import type { PositionAwareChunk } from "../../../src/types/index.js"
import { DocumentId, PositionAwareChunkId } from "../../../src/types/index.js"
import { InMemoryVectorStore } from "../../../src/vector-stores/in-memory.js"
import { mockEmbedder, samplePositionAwareChunks } from "../../fixtures.js"

function chunk(id: string, content = id): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc-1"),
    start: 0,
    end: content.length,
    metadata: {}
  }
}

describe("InMemoryVectorStore", () => {
  it("should add and search chunks", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    const results = await store.search(queryEmb, { k: 2 })

    expect(results).toHaveLength(2)
    // First result should be the most similar (itself)
    expect(results[0].chunk.id).toBe(chunks[0].id)
    expect(results[0].score).toBeTypeOf("number")
    expect(results[0].score).toBeGreaterThan(0)
  })

  it("should return scores in descending order", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    const results = await store.search(queryEmb, { k: chunks.length })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it("should respect k parameter", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    const results = await store.search(queryEmb, { k: 1 })
    expect(results).toHaveLength(1)
  })

  it("should clear all data", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)
    await store.clear()

    const queryEmb = await embedder.embedQuery("test")
    const results = await store.search(queryEmb, { k: 5 })
    expect(results).toHaveLength(0)
  })

  it("should return empty for empty store", async () => {
    const store = new InMemoryVectorStore()
    const results = await store.search([0.1, 0.2, 0.3], { k: 5 })
    expect(results).toHaveLength(0)
  })

  it("should preserve chunk positions", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    const results = await store.search(queryEmb, { k: 1 })

    expect(results[0].chunk.start).toBe(0)
    expect(results[0].chunk.end).toBe(50)
    expect(results[0].chunk.docId).toBe(chunks[0].docId)
  })

  it("accumulates across multiple add() calls (no wipe)", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    // First add with chunk[0]
    await store.add([chunks[0]], [embeddings[0]])
    // Second add with chunk[1] - should accumulate, not wipe
    await store.add([chunks[1]], [embeddings[1]])

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    const results = await store.search(queryEmb, { k: 10 })

    // Both chunks should be present
    expect(results).toHaveLength(2)
  })

  it("should return all available chunks when k > stored chunks", async () => {
    const store = new InMemoryVectorStore()
    const chunks = samplePositionAwareChunks()
    const embedder = mockEmbedder()
    const embeddings = await embedder.embed(chunks.map((c) => c.content))

    await store.add(chunks, embeddings)

    const queryEmb = await embedder.embedQuery(chunks[0].content)
    // Request more than available
    const results = await store.search(queryEmb, { k: 100 })

    expect(results).toHaveLength(chunks.length)
  })
})

describe("InMemoryVectorStore v2", () => {
  it("accumulates across multiple add() calls (no wipe)", async () => {
    const store = new InMemoryVectorStore()
    await store.add([chunk("a")], [[1, 0]])
    await store.add([chunk("b")], [[0, 1]])
    const results = await store.search([1, 0], { k: 10 })
    expect(results.map((r) => String(r.chunk.id)).sort()).toEqual(["a", "b"])
  })

  it("dedupes re-added chunk ids", async () => {
    const store = new InMemoryVectorStore()
    await store.add([chunk("a")], [[1, 0]])
    await store.add([chunk("a")], [[1, 0]])
    expect(await store.search([1, 0], { k: 10 })).toHaveLength(1)
  })

  it("search honors kbId/indexConfigHash/documentId filters", async () => {
    const store = new InMemoryVectorStore()
    await store.add([chunk("a")], [[1, 0]], {
      kbId: "kb1",
      indexConfigHash: "h1"
    })
    await store.add([chunk("b")], [[1, 0]], {
      kbId: "kb2",
      indexConfigHash: "h2"
    })
    const kb1 = await store.search([1, 0], { k: 10, filter: { kbId: "kb1" } })
    expect(kb1.map((r) => String(r.chunk.id))).toEqual(["a"])
    const h2 = await store.search([1, 0], {
      k: 10,
      filter: { indexConfigHash: "h2" }
    })
    expect(h2.map((r) => String(r.chunk.id))).toEqual(["b"])
    const none = await store.search([1, 0], {
      k: 10,
      filter: { kbId: "kb1", indexConfigHash: "h2" }
    })
    expect(none).toEqual([])
  })

  it("entries without scope only match empty filters", async () => {
    const store = new InMemoryVectorStore()
    await store.add([chunk("a")], [[1, 0]])
    expect(
      await store.search([1, 0], { k: 10, filter: { kbId: "kb1" } })
    ).toEqual([])
    expect(await store.search([1, 0], { k: 10 })).toHaveLength(1)
  })

  it("deleteByDocument / deleteByKnowledgeBase / scoped clear", async () => {
    const store = new InMemoryVectorStore()
    await store.add([chunk("a")], [[1, 0]], { kbId: "kb1", documentId: "d1" })
    await store.add([chunk("b")], [[1, 0]], { kbId: "kb1", documentId: "d2" })
    await store.deleteByDocument("d1")
    expect(await store.search([1, 0], { k: 10 })).toHaveLength(1)
    await store.deleteByKnowledgeBase("kb1")
    expect(await store.search([1, 0], { k: 10 })).toHaveLength(0)
  })

  it("checkHealth returns true", async () => {
    expect(await new InMemoryVectorStore().checkHealth()).toBe(true)
  })
})
