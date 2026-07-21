import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  mediaCollectionName,
  mediaPointId,
  QdrantMediaStore
} from "../../../src/vector-stores/qdrant-media.js"

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

const notFound = () =>
  new Response(JSON.stringify({ status: { error: "not found" } }), {
    status: 404
  })

function collectionInfo(size: number) {
  return okJson({
    status: "ok",
    result: { config: { params: { vectors: { size, distance: "Cosine" } } } }
  })
}

describe("mediaPointId", () => {
  it("is a deterministic UUID-format id derived from the imageId", () => {
    const a = mediaPointId("img_deadbeef")
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(mediaPointId("img_deadbeef")).toBe(a)
    expect(mediaPointId("img_feedface")).not.toBe(a)
  })
})

describe("mediaCollectionName", () => {
  it("uses a kb_media_ prefix distinct from chunk collections", () => {
    expect(mediaCollectionName("openai", "text-embedding-3-small")).toBe(
      "kb_media_openai_text-embedding-3-small"
    )
  })

  it("sanitizes provider/model into a safe collection name", () => {
    expect(mediaCollectionName("open ai", "model/v1")).toBe(
      "kb_media_open_ai_model_v1"
    )
  })
})

describe("QdrantMediaStore", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let store: QdrantMediaStore

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    store = new QdrantMediaStore({
      url: "https://qdrant.example.com:6333",
      apiKey: "test-key",
      collection: "kb_media_openai_x",
      dimension: 2,
      retry: { maxRetries: 0 }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("rejects non-HTTPS endpoints", () => {
    expect(
      () =>
        new QdrantMediaStore({
          url: "http://qdrant.example.com:6333",
          collection: "kb_media_x",
          dimension: 2
        })
    ).toThrow(/https/i)
  })

  it("upserts media points with imageId-derived ids and payload", async () => {
    // ensureCollection: GET(404) → PUT create → PUT payload index x2; then PUT points
    fetchMock
      .mockResolvedValueOnce(notFound()) // GET collection
      .mockResolvedValueOnce(okJson({ result: true })) // PUT create
      .mockResolvedValueOnce(okJson({ result: true })) // index kbId
      .mockResolvedValueOnce(okJson({ result: true })) // index sourceDocId
      .mockResolvedValueOnce(okJson({ result: { status: "completed" } })) // PUT points

    await store.upsert(
      [{ imageId: "img_a", embedding: [1, 0], alt: "a", mediaType: "image" }],
      { kbId: "kb1", orgId: "org1", sourceDocId: "doc1" }
    )

    const putPoints = fetchMock.mock.calls.at(-1)!
    expect(putPoints[0]).toContain(
      "/collections/kb_media_openai_x/points"
    )
    const body = JSON.parse((putPoints[1] as RequestInit).body as string)
    expect(body.points).toHaveLength(1)
    expect(body.points[0].id).toBe(mediaPointId("img_a"))
    expect(body.points[0].vector).toEqual([1, 0])
    expect(body.points[0].payload).toMatchObject({
      imageId: "img_a",
      kbId: "kb1",
      orgId: "org1",
      sourceDocId: "doc1",
      alt: "a",
      mediaType: "image"
    })
  })

  it("rejects an embedding whose dimension does not match the collection", async () => {
    await expect(
      store.upsert(
        [{ imageId: "img_a", embedding: [1, 0, 0], alt: "a", mediaType: "image" }],
        { kbId: "kb1", orgId: "org1", sourceDocId: "doc1" }
      )
    ).rejects.toThrow(/dimension/i)
  })

  it("fetches vectors by imageId and returns them keyed by imageId", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        result: [
          {
            id: mediaPointId("img_a"),
            vector: [1, 0],
            payload: { imageId: "img_a", kbId: "kb1" }
          },
          {
            id: mediaPointId("img_b"),
            vector: [0, 1],
            payload: { imageId: "img_b", kbId: "kb1" }
          }
        ]
      })
    )

    const out = await store.fetchByIds(["img_a", "img_b"], { kbId: "kb1" })
    expect(out).toEqual([
      { imageId: "img_a", embedding: [1, 0] },
      { imageId: "img_b", embedding: [0, 1] }
    ])

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.ids).toEqual([mediaPointId("img_a"), mediaPointId("img_b")])
    expect(body.with_vector).toBe(true)
  })

  it("drops points whose payload kbId does not match the requested tenant", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        result: [
          {
            id: mediaPointId("img_a"),
            vector: [1, 0],
            payload: { imageId: "img_a", kbId: "kb1" }
          },
          {
            id: mediaPointId("img_x"),
            vector: [9, 9],
            payload: { imageId: "img_x", kbId: "other-kb" }
          }
        ]
      })
    )

    const out = await store.fetchByIds(["img_a", "img_x"], { kbId: "kb1" })
    expect(out).toEqual([{ imageId: "img_a", embedding: [1, 0] }])
  })

  it("returns [] when the collection does not exist yet (404)", async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const out = await store.fetchByIds(["img_a"], { kbId: "kb1" })
    expect(out).toEqual([])
  })

  it("returns [] without a request for an empty id list", async () => {
    const out = await store.fetchByIds([], { kbId: "kb1" })
    expect(out).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("deletes a source doc's points via a kbId+sourceDocId filter", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ result: { status: "completed" } })
    )
    await store.deleteBySourceDoc("doc1", { kbId: "kb1" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/collections/kb_media_openai_x/points/delete")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.filter.must).toEqual(
      expect.arrayContaining([
        { key: "kbId", match: { value: "kb1" } },
        { key: "sourceDocId", match: { value: "doc1" } }
      ])
    )
  })

  it("treats a 404 on delete as a no-op (collection never created)", async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    await expect(
      store.deleteBySourceDoc("doc1", { kbId: "kb1" })
    ).resolves.toBeUndefined()
  })

  it("deletes specific media points by imageId", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ result: { status: "completed" } })
    )
    await store.deleteByIds(["img_a", "img_b"])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/collections/kb_media_openai_x/points/delete")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.points).toEqual([mediaPointId("img_a"), mediaPointId("img_b")])
  })

  it("does not issue a request when deleting an empty id list", async () => {
    await store.deleteByIds([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats a 404 on deleteByIds as a no-op", async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    await expect(store.deleteByIds(["img_a"])).resolves.toBeUndefined()
  })
})
