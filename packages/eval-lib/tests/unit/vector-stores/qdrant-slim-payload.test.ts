import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../../../src/types/index.js"
import {
  QdrantVectorStore,
  type QdrantVectorStoreConfig
} from "../../../src/vector-stores/qdrant.js"
import { encodeDocument } from "../../../src/vector-stores/sparse/bm25-encoder.js"

const BASE: QdrantVectorStoreConfig = {
  url: "https://qdrant.example.com:6333",
  apiKey: "test-key",
  collection: "kb_x_abcdef",
  dimension: 3,
  retry: { maxRetries: 0 }
}

const VALID_SCOPE = { kbId: "kb1", indexConfigHash: "h1", documentId: "cvx1" }

const METADATA_KEYS = ["parentChunkId", "level"] as const

function chunk(
  id: string,
  content = "alpha bravo charlie"
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc-1"),
    start: 12,
    end: 12 + content.length,
    metadata: {
      parentChunkId: "p1",
      level: "child",
      pageStart: 4,
      sourceUrl: "https://example.com/secret-path"
    }
  }
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

function collectionInfo(size: number) {
  return okJson({
    status: "ok",
    result: { config: { params: { vectors: { size, distance: "Cosine" } } } }
  })
}

function sparseCollectionInfo(size: number) {
  return okJson({
    status: "ok",
    result: {
      config: {
        params: {
          vectors: { dense: { size, distance: "Cosine" } },
          sparse_vectors: { bm25: { modifier: "idf" } }
        }
      }
    }
  })
}

describe("QdrantVectorStore payloadMode", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Existing collection: GET dimension, 3 payload indexes, then the upsert. */
  function mockExistingCollection(info: Response) {
    fetchMock
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} }))
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} }))
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} }))
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} }))
  }

  const upsertedPoint = () =>
    JSON.parse(fetchMock.mock.calls[4][1].body).points[0]

  describe("slim", () => {
    const slimStore = () =>
      new QdrantVectorStore({
        ...BASE,
        payloadMode: "slim",
        payloadMetadataKeys: METADATA_KEYS
      })

    it("stores identity, scope and allowlisted metadata only", async () => {
      mockExistingCollection(collectionInfo(3))
      await slimStore().add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)

      const { payload } = upsertedPoint()
      expect(payload).toEqual({
        chunkId: "c1",
        docId: "doc-1",
        metadata: { parentChunkId: "p1", level: "child" },
        kbId: "kb1",
        indexConfigHash: "h1",
        documentId: "cvx1"
      })
      expect(Object.keys(payload).sort()).toEqual([
        "chunkId",
        "docId",
        "documentId",
        "indexConfigHash",
        "kbId",
        "metadata"
      ])
    })

    it("keeps no metadata when no keys are allowlisted", async () => {
      mockExistingCollection(collectionInfo(3))
      await new QdrantVectorStore({ ...BASE, payloadMode: "slim" }).add(
        [chunk("c1")],
        [[1, 0, 0]],
        VALID_SCOPE
      )
      expect(upsertedPoint().payload.metadata).toEqual({})
    })

    it("passes the dense embedding through unchanged", async () => {
      mockExistingCollection(collectionInfo(3))
      await slimStore().add([chunk("c1")], [[0.5, 0.25, 0]], VALID_SCOPE)
      expect(upsertedPoint().vector).toEqual([0.5, 0.25, 0])
    })

    it("still encodes the BM25 sparse vector from the real chunk text", async () => {
      mockExistingCollection(sparseCollectionInfo(3))
      const store = new QdrantVectorStore({
        ...BASE,
        sparse: true,
        payloadMode: "slim",
        payloadMetadataKeys: METADATA_KEYS
      })
      await store.add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)

      const point = upsertedPoint()
      const expected = encodeDocument("alpha bravo charlie", {})
      expect(point.vector.bm25).toEqual({
        indices: expected.indices,
        values: expected.values
      })
      expect(point.vector.bm25.indices.length).toBeGreaterThan(0)
      expect(point.payload.content).toBeUndefined()
    })

    it("search(): returns placeholder content/offsets with identity intact", async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({
          status: "ok",
          result: {
            points: [
              {
                id: "x",
                score: 0.9,
                payload: {
                  chunkId: "c1",
                  docId: "doc-1",
                  metadata: { parentChunkId: "p1", level: "child" },
                  kbId: "kb1",
                  indexConfigHash: "h1",
                  documentId: "cvx1"
                }
              }
            ]
          }
        })
      )
      const [hit] = await slimStore().search([1, 0, 0], {
        k: 5,
        filter: { kbId: "kb1" }
      })

      expect(String(hit.chunk.id)).toBe("c1")
      expect(String(hit.chunk.docId)).toBe("doc-1")
      expect(hit.chunk.content).toBe("")
      expect(hit.chunk.start).toBe(0)
      expect(hit.chunk.end).toBe(0)
      expect(hit.chunk.metadata).toEqual({
        parentChunkId: "p1",
        level: "child"
      })
      expect(hit.score).toBe(0.9)
    })

    it("search(): returns placeholders even when a legacy point still carries the full payload", async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({
          status: "ok",
          result: {
            points: [
              {
                id: "x",
                score: 0.9,
                payload: {
                  chunkId: "c1",
                  content: "alpha bravo charlie",
                  docId: "doc-1",
                  start: 12,
                  end: 31,
                  metadata: {
                    parentChunkId: "p1",
                    level: "child",
                    pageStart: 4,
                    sourceUrl: "https://example.com/secret-path"
                  },
                  kbId: "kb1",
                  indexConfigHash: "h1",
                  documentId: "cvx1"
                }
              }
            ]
          }
        })
      )
      const [hit] = await slimStore().search([1, 0, 0], {
        k: 5,
        filter: { kbId: "kb1" }
      })

      expect(hit.chunk.content).toBe("")
      expect(hit.chunk.start).toBe(0)
      expect(hit.chunk.end).toBe(0)
      expect(hit.chunk.metadata).toEqual({
        parentChunkId: "p1",
        level: "child"
      })
    })

    it("searchSparse(): returns placeholders for legacy full points too", async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({
          status: "ok",
          result: {
            points: [
              {
                id: "x",
                score: 3.2,
                payload: {
                  chunkId: "c1",
                  content: "alpha bravo charlie",
                  docId: "doc-1",
                  start: 12,
                  end: 31,
                  metadata: { level: "child", sourceUrl: "https://example.com/x" }
                }
              }
            ]
          }
        })
      )
      const store = new QdrantVectorStore({
        ...BASE,
        sparse: true,
        payloadMode: "slim",
        payloadMetadataKeys: METADATA_KEYS
      })
      const [hit] = await store.searchSparse("alpha bravo", {
        k: 5,
        filter: { kbId: "kb1" }
      })

      expect(hit.chunk.content).toBe("")
      expect(hit.chunk.start).toBe(0)
      expect(hit.chunk.end).toBe(0)
      expect(hit.chunk.metadata).toEqual({ level: "child" })
    })

    it("searchSparse(): still hits and returns placeholder content", async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({
          status: "ok",
          result: {
            points: [
              {
                id: "x",
                score: 3.2,
                payload: {
                  chunkId: "c1",
                  docId: "doc-1",
                  metadata: { level: "child" },
                  kbId: "kb1",
                  indexConfigHash: "h1",
                  documentId: "cvx1"
                }
              }
            ]
          }
        })
      )
      const store = new QdrantVectorStore({
        ...BASE,
        sparse: true,
        payloadMode: "slim",
        payloadMetadataKeys: METADATA_KEYS
      })
      const results = await store.searchSparse("alpha bravo", {
        k: 5,
        filter: { kbId: "kb1" }
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.using).toBe("bm25")
      expect(body.filter).toEqual({
        must: [{ key: "kbId", match: { value: "kb1" } }]
      })
      expect(results).toHaveLength(1)
      expect(String(results[0].chunk.id)).toBe("c1")
      expect(results[0].chunk.content).toBe("")
      expect(results[0].score).toBe(3.2)
    })

    it("keeps scoped deletes filtering on payload scope fields", async () => {
      fetchMock.mockImplementation(async () =>
        okJson({ status: "ok", result: {} })
      )
      const store = slimStore()
      await store.deleteByDocument("cvx1", { kbId: "kb1" })
      await store.deleteByKnowledgeBase("kb1")
      await store.clear({ kbId: "kb1", indexConfigHash: "h1" })

      const filters = fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(init.body).filter
      )
      expect(filters[0]).toEqual({
        must: [
          { key: "kbId", match: { value: "kb1" } },
          { key: "documentId", match: { value: "cvx1" } }
        ]
      })
      expect(filters[1]).toEqual({
        must: [{ key: "kbId", match: { value: "kb1" } }]
      })
      expect(filters[2]).toEqual({
        must: [
          { key: "kbId", match: { value: "kb1" } },
          { key: "indexConfigHash", match: { value: "h1" } }
        ]
      })
    })
  })

  describe("full (default)", () => {
    it("writes the self-contained payload, byte-identical with or without the option", async () => {
      mockExistingCollection(collectionInfo(3))
      await new QdrantVectorStore(BASE).add(
        [chunk("c1")],
        [[1, 0, 0]],
        VALID_SCOPE
      )
      const implicitBody = fetchMock.mock.calls[4][1].body

      fetchMock.mockClear()
      mockExistingCollection(collectionInfo(3))
      await new QdrantVectorStore({
        ...BASE,
        payloadMode: "full",
        payloadMetadataKeys: METADATA_KEYS
      }).add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)

      expect(fetchMock.mock.calls[4][1].body).toBe(implicitBody)
      expect(JSON.parse(implicitBody).points[0].payload).toEqual({
        chunkId: "c1",
        content: "alpha bravo charlie",
        docId: "doc-1",
        start: 12,
        end: 31,
        metadata: {
          parentChunkId: "p1",
          level: "child",
          pageStart: 4,
          sourceUrl: "https://example.com/secret-path"
        },
        kbId: "kb1",
        indexConfigHash: "h1",
        documentId: "cvx1"
      })
    })

    it("search(): still reads content and offsets from the payload", async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({
          status: "ok",
          result: {
            points: [
              {
                id: "x",
                score: 0.9,
                payload: {
                  chunkId: "c1",
                  content: "hello",
                  docId: "doc-1",
                  start: 12,
                  end: 17,
                  metadata: { level: "child" }
                }
              }
            ]
          }
        })
      )
      const [hit] = await new QdrantVectorStore(BASE).search([1, 0, 0], {
        k: 5,
        filter: { kbId: "kb1" }
      })
      expect(hit.chunk.content).toBe("hello")
      expect(hit.chunk.start).toBe(12)
      expect(hit.chunk.end).toBe(17)
    })
  })
})
