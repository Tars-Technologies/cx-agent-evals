import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../../../src/types/index.js"
import {
  encodeDocument,
  encodeQuery
} from "../../../src/vector-stores/sparse/bm25-encoder.js"
import {
  QdrantVectorStore,
  qdrantPointId
} from "../../../src/vector-stores/qdrant.js"

function chunk(id: string, content = "alpha bravo charlie"): PositionAwareChunk {
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

const VALID_SCOPE = { kbId: "kb1", indexConfigHash: "h1", documentId: "cvx1" }

/** Named-hybrid collection info: dimension lives under params.vectors.dense. */
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

describe("QdrantVectorStore (sparse / named hybrid)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let store: QdrantVectorStore

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    store = new QdrantVectorStore({
      url: "https://qdrant.example.com:6333",
      apiKey: "test-key",
      collection: "kb_x_abcdef",
      dimension: 3,
      retry: { maxRetries: 0 },
      sparse: true
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("reports sparse support", () => {
    expect(store.supportsSparse).toBe(true)
  })

  it("creates a named-hybrid collection (dense + bm25 idf) when missing", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 })) // GET
      .mockResolvedValueOnce(okJson({ status: "ok", result: true })) // PUT create
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index kbId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index indexConfigHash
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index documentId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // upsert
    await store.add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)

    const [createUrl, createInit] = fetchMock.mock.calls[1]
    expect(createUrl).toBe(
      "https://qdrant.example.com:6333/collections/kb_x_abcdef"
    )
    expect(createInit.method).toBe("PUT")
    // Dense moves under the named "dense" key (keeping on-disk + int8 quant);
    // the BM25 sparse vector is declared with server-side IDF.
    expect(JSON.parse(createInit.body)).toEqual({
      vectors: {
        dense: {
          size: 3,
          distance: "Cosine",
          on_disk: true,
          quantization_config: { scalar: { type: "int8", always_ram: true } }
        }
      },
      sparse_vectors: {
        bm25: { modifier: "idf", index: { on_disk: true } }
      },
      on_disk_payload: true,
      hnsw_config: { m: 0, payload_m: 16 }
    })
  })

  it("verifies the dimension from the named dense vector", async () => {
    // A dimension mismatch on the named dense vector must still be caught.
    fetchMock.mockResolvedValueOnce(sparseCollectionInfo(1536))
    await expect(
      store.add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)
    ).rejects.toThrow(/dimension 1536.*expected 3/i)
  })

  it("rejects an unnamed-dense collection when expecting the sparse shape", async () => {
    // An old unnamed collection has params.vectors.size but no .dense.size.
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: "ok",
        result: { config: { params: { vectors: { size: 3 } } } }
      })
    )
    await expect(
      store.add([chunk("c1")], [[1, 0, 0]], VALID_SCOPE)
    ).rejects.toThrow(/named "dense" vector size|refusing to use it/i)
  })

  it("upserts dense + bm25 vectors atomically on one point", async () => {
    fetchMock
      .mockResolvedValueOnce(sparseCollectionInfo(3)) // GET collection
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index kbId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index indexConfigHash
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // index documentId
      .mockResolvedValueOnce(okJson({ status: "ok", result: {} })) // upsert
    await store.add([chunk("c1", "hello world")], [[1, 0, 0]], VALID_SCOPE)

    const [upsertUrl, upsertInit] = fetchMock.mock.calls[4]
    expect(upsertUrl).toBe(
      "https://qdrant.example.com:6333/collections/kb_x_abcdef/points?wait=true"
    )
    const body = JSON.parse(upsertInit.body)
    expect(body.points).toHaveLength(1)
    expect(body.points[0].id).toBe(qdrantPointId("c1", VALID_SCOPE))
    // One point carries both named vectors so they cannot drift.
    const expectedSparse = encodeDocument("hello world")
    expect(body.points[0].vector).toEqual({
      dense: [1, 0, 0],
      bm25: { indices: expectedSparse.indices, values: expectedSparse.values }
    })
    expect(body.points[0].payload.content).toBe("hello world")
  })

  it("dense search targets the named dense vector (using: 'dense')", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ status: "ok", result: { points: [] } })
    )
    await store.search([1, 0, 0], { k: 5, filter: { kbId: "kb1" } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.using).toBe("dense")
    expect(body.query).toEqual([1, 0, 0])
  })

  it("searchSparse(): encodes the query and runs the bm25 sparse query", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        status: "ok",
        result: {
          points: [
            {
              id: "x",
              score: 4.2,
              payload: {
                chunkId: "c1",
                content: "alpha bravo",
                docId: "doc-1",
                start: 0,
                end: 11,
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
    const results = await store.searchSparse("alpha bravo", {
      k: 5,
      filter: { kbId: "kb1" }
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://qdrant.example.com:6333/collections/kb_x_abcdef/points/query"
    )
    const expected = encodeQuery("alpha bravo")
    expect(JSON.parse(init.body)).toEqual({
      query: { indices: expected.indices, values: expected.values },
      using: "bm25",
      limit: 5,
      with_payload: true,
      filter: { must: [{ key: "kbId", match: { value: "kb1" } }] }
    })
    expect(results).toHaveLength(1)
    expect(String(results[0].chunk.id)).toBe("c1")
    expect(results[0].score).toBe(4.2)
  })

  it("searchSparse(): refuses an unscoped query without a tenant kbId", async () => {
    await expect(
      store.searchSparse("alpha", { k: 5 })
    ).rejects.toThrow(/tenant scope|filter\.kbId/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("searchSparse(): short-circuits a query with no terms (no request)", async () => {
    await expect(
      store.searchSparse("!!! ???", { k: 5, filter: { kbId: "kb1" } })
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("searchSparse(): treats an unprovisioned collection (404) as no results", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }))
    await expect(
      store.searchSparse("alpha", { k: 5, filter: { kbId: "kb1" } })
    ).resolves.toEqual([])
  })
})

describe("QdrantVectorStore (sparse: false default)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let store: QdrantVectorStore

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    store = new QdrantVectorStore({
      url: "https://qdrant.example.com:6333",
      collection: "kb_x_abcdef",
      dimension: 3,
      retry: { maxRetries: 0 }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("does not advertise sparse support by default", () => {
    expect(store.supportsSparse).toBe(false)
  })

  it("searchSparse() no-ops to [] without issuing a request", async () => {
    await expect(
      store.searchSparse("alpha", { k: 5, filter: { kbId: "kb1" } })
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("dense search omits `using` (unnamed-dense shape unchanged)", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ status: "ok", result: { points: [] } })
    )
    await store.search([1, 0, 0], { k: 5, filter: { kbId: "kb1" } })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.using).toBeUndefined()
    expect(body.query).toEqual([1, 0, 0])
  })
})
