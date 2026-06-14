import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../../../src/types/index.js"
import {
  QdrantVectorStore,
  qdrantPointId
} from "../../../src/vector-stores/qdrant.js"

function chunk(id: string, content = "text"): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc-1"),
    start: 0,
    end: content.length,
    metadata: { level: "child" }
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

describe("QdrantVectorStore", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let store: QdrantVectorStore

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    store = new QdrantVectorStore({
      url: "http://qdrant.local:6333",
      apiKey: "test-key",
      collection: "kb_x_abcdef",
      dimension: 3,
      retry: { maxRetries: 0 }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("derives a deterministic UUID-format point id from the chunk id", () => {
    const a = qdrantPointId("chunk-1")
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(qdrantPointId("chunk-1")).toBe(a)
    expect(qdrantPointId("chunk-2")).not.toBe(a)
  })

  it("add(): ensures the collection then upserts self-contained points", async () => {
    fetchMock
      .mockResolvedValueOnce(collectionInfo(3)) // GET collection (exists)
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index kbId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index indexConfigHash
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index documentId
      .mockResolvedValueOnce(
        okJson({ status: "ok", result: { status: "completed" } })
      ) // upsert
    await store.add([chunk("c1", "hello")], [[1, 0, 0]], {
      kbId: "kb1",
      indexConfigHash: "h1",
      documentId: "cvx1"
    })

    const [getUrl, getInit] = fetchMock.mock.calls[0]
    expect(getUrl).toBe("http://qdrant.local:6333/collections/kb_x_abcdef")
    expect(getInit.headers["api-key"]).toBe("test-key")

    const [upsertUrl, upsertInit] = fetchMock.mock.calls[4]
    expect(upsertUrl).toBe(
      "http://qdrant.local:6333/collections/kb_x_abcdef/points?wait=true"
    )
    expect(upsertInit.method).toBe("PUT")
    const body = JSON.parse(upsertInit.body)
    expect(body.points).toHaveLength(1)
    expect(body.points[0].id).toBe(qdrantPointId("c1"))
    expect(body.points[0].vector).toEqual([1, 0, 0])
    expect(body.points[0].payload).toEqual({
      chunkId: "c1",
      content: "hello",
      docId: "doc-1",
      start: 0,
      end: 5,
      metadata: { level: "child" },
      kbId: "kb1",
      indexConfigHash: "h1",
      documentId: "cvx1"
    })
  })

  it("add(): creates the collection and payload indexes when missing (404)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(okJson({ status: "ok", result: true })) // PUT create
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index kbId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index indexConfigHash
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index documentId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // upsert
    await store.add([chunk("c1")], [[1, 0, 0]])
    const [createUrl, createInit] = fetchMock.mock.calls[1]
    expect(createUrl).toBe("http://qdrant.local:6333/collections/kb_x_abcdef")
    expect(createInit.method).toBe("PUT")
    expect(JSON.parse(createInit.body)).toEqual({
      vectors: { size: 3, distance: "Cosine" }
    })
    const indexedFields = fetchMock.mock.calls
      .slice(2, 5)
      .map(([url, init]: [string, RequestInit]) => {
        expect(url).toBe(
          "http://qdrant.local:6333/collections/kb_x_abcdef/index?wait=true"
        )
        return JSON.parse(init.body as string)
      })
    expect(indexedFields).toEqual([
      { field_name: "kbId", field_schema: "keyword" },
      { field_name: "indexConfigHash", field_schema: "keyword" },
      { field_name: "documentId", field_schema: "keyword" }
    ])
  })

  it("add(): throws loudly on collection dimension mismatch", async () => {
    fetchMock.mockResolvedValueOnce(collectionInfo(1536))
    await expect(store.add([chunk("c1")], [[1, 0, 0]])).rejects.toThrow(
      /dimension 1536.*expected 3/i
    )
  })

  it("add(): fails closed when the collection reports no vector size", async () => {
    // A named-vector (or otherwise reshaped) collection returns no top-level
    // `size`; the store creates only single-vector collections, so this is an
    // incompatible shape and must be rejected rather than silently used.
    fetchMock.mockResolvedValueOnce(
      okJson({ status: "ok", result: { config: { params: { vectors: {} } } } })
    )
    await expect(store.add([chunk("c1")], [[1, 0, 0]])).rejects.toThrow(
      /no vector size|unexpected shape/i
    )
  })

  it("add(): tolerates a concurrent collection create (409) and re-verifies", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 })) // GET
      .mockResolvedValueOnce(
        new Response("Collection `kb_x_abcdef` already exists!", {
          status: 409
        })
      ) // PUT create lost the race
      .mockResolvedValueOnce(collectionInfo(3)) // re-verify GET
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index kbId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index indexConfigHash
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index documentId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // upsert
    await store.add([chunk("c1")], [[1, 0, 0]])
    expect(fetchMock).toHaveBeenCalledTimes(7)
    const [upsertUrl] = fetchMock.mock.calls[6]
    expect(upsertUrl).toBe(
      "http://qdrant.local:6333/collections/kb_x_abcdef/points?wait=true"
    )
  })

  it("add(): 409 race still fails loudly when the winner's dimension differs", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 })) // GET
      .mockResolvedValueOnce(new Response("exists", { status: 409 })) // PUT create
      .mockResolvedValueOnce(collectionInfo(1536)) // re-verify GET: wrong dims
    await expect(store.add([chunk("c1")], [[1, 0, 0]])).rejects.toThrow(
      /dimension 1536.*expected 3/i
    )
  })

  it("add(): validates lengths and embedding dimension", async () => {
    await expect(store.add([chunk("c1")], [])).rejects.toThrow(/1 chunks but 0/)
    await expect(store.add([chunk("c1")], [[1, 0]])).rejects.toThrow(
      /dimension 2.*expected 3/i
    )
  })

  it("search(): queries with the vector and maps payloads back to chunks", async () => {
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
                start: 0,
                end: 5,
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
    const results = await store.search([1, 0, 0], { k: 5 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "http://qdrant.local:6333/collections/kb_x_abcdef/points/query"
    )
    expect(JSON.parse(init.body)).toEqual({
      query: [1, 0, 0],
      limit: 5,
      with_payload: true
    })
    expect(results).toHaveLength(1)
    expect(String(results[0].chunk.id)).toBe("c1")
    expect(results[0].chunk.content).toBe("hello")
    expect(String(results[0].chunk.docId)).toBe("doc-1")
    expect(results[0].score).toBe(0.9)
  })

  it("search(): sends a payload filter for documentId", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ status: "ok", result: { points: [] } })
    )
    await store.search([1, 0, 0], { k: 2, filter: { documentId: "cvx1" } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).filter).toEqual({
      must: [{ key: "documentId", match: { value: "cvx1" } }]
    })
  })

  it("deleteByDocument(): deletes points by payload filter", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ status: "ok", result: {} }))
    await store.deleteByDocument("cvx1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "http://qdrant.local:6333/collections/kb_x_abcdef/points/delete?wait=true"
    )
    expect(JSON.parse(init.body)).toEqual({
      filter: { must: [{ key: "documentId", match: { value: "cvx1" } }] }
    })
  })

  it("deleteByKnowledgeBase()/clear(): drop the collection", async () => {
    // Fresh Response per call: a Response body can only be read once.
    fetchMock.mockImplementation(async () =>
      okJson({ status: "ok", result: true })
    )
    await store.deleteByKnowledgeBase("kb1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://qdrant.local:6333/collections/kb_x_abcdef"
    )
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    await store.clear()
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE")
  })

  it("deleteByKnowledgeBase(): treats a missing collection (404) as already dropped", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    await expect(store.deleteByKnowledgeBase("kb1")).resolves.toBeUndefined()
  })

  it("checkHealth(): probes liveness without provisioning the collection", async () => {
    // True when the collection exists: a single non-provisioning GET, no PUTs.
    fetchMock.mockResolvedValueOnce(collectionInfo(3)) // GET collection
    expect(await store.checkHealth()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://qdrant.local:6333/collections/kb_x_abcdef")
    expect(init.method ?? "GET").toBe("GET")
    expect(
      fetchMock.mock.calls.every(
        ([, i]: [string, RequestInit]) => i.method !== "PUT"
      )
    ).toBe(true)

    // False (not true) when the collection is missing: a passive probe must
    // NOT resurrect a dropped collection.
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    expect(await store.checkHealth()).toBe(false)
    expect(
      fetchMock.mock.calls.every(
        ([, i]: [string, RequestInit]) => i.method !== "PUT"
      )
    ).toBe(true)

    // False when the instance is unreachable.
    fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    expect(await store.checkHealth()).toBe(false)
  })

  it("search(): returns [] when the collection is not ready (404)", async () => {
    // Store parity with native/in-memory: a missing collection yields no
    // results rather than an opaque 404 throw.
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    await expect(store.search([1, 0, 0], { k: 5 })).resolves.toEqual([])
  })

  it("clear(): rejects a non-empty filter instead of silently dropping all", async () => {
    await expect(
      store.clear({ documentId: "cvx1" })
    ).rejects.toThrow(/filter/i)
    // A filtered clear must not issue any destructive request.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("omits the api-key header when no key configured", async () => {
    const open = new QdrantVectorStore({
      url: "http://localhost:6333",
      collection: "c",
      dimension: 3,
      retry: { maxRetries: 0 }
    })
    fetchMock.mockResolvedValueOnce(collectionInfo(3))
    fetchMock.mockImplementation(async () =>
      okJson({ status: "ok", result: {} })
    )
    await open.checkHealth()
    expect(fetchMock.mock.calls[0][1].headers["api-key"]).toBeUndefined()
  })

  it("non-2xx responses throw with provider/status/body", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(store.search([1, 0, 0], { k: 1 })).rejects.toThrow(
      /Qdrant API error: 500/
    )
  })

  it("does not retry non-retryable 4xx responses (e.g. bad key)", async () => {
    const retrying = new QdrantVectorStore({
      url: "http://qdrant.local:6333",
      apiKey: "bad-key",
      collection: "kb_x_abcdef",
      dimension: 3,
      retry: { maxRetries: 3, backoffMs: 0 }
    })
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    await expect(retrying.search([1, 0, 0], { k: 1 })).rejects.toThrow(
      /Qdrant API error: 403/
    )
    // 403 is a client error: fail fast, no retry storm.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries retryable 5xx responses up to maxRetries", async () => {
    const retrying = new QdrantVectorStore({
      url: "http://qdrant.local:6333",
      apiKey: "test-key",
      collection: "kb_x_abcdef",
      dimension: 3,
      retry: { maxRetries: 2, backoffMs: 0 }
    })
    // Fresh Response per call: a Response body can only be read once.
    fetchMock.mockImplementation(
      async () => new Response("server error", { status: 503 })
    )
    await expect(retrying.search([1, 0, 0], { k: 1 })).rejects.toThrow(
      /Qdrant API error: 503/
    )
    // Initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
