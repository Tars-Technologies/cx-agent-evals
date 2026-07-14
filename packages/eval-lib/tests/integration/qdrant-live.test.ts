/**
 * Live Qdrant verification (gated). Exercises the REAL QdrantVectorStore against
 * a live cloud instance to confirm the one unknown the mocked unit tests cannot:
 * Qdrant accepts the named-hybrid shape, dual-vector upsert, and the
 * `using:"bm25"` / `modifier:"idf"` sparse query, and that sparse:false is
 * unchanged. Runs only when QDRANT_LIVE=1 and QDRANT_URL/QDRANT_API_KEY are set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../../src/types/index.js"
import { QdrantVectorStore } from "../../src/vector-stores/qdrant.js"

const LIVE = process.env.QDRANT_LIVE === "1"
const URL = process.env.QDRANT_URL ?? ""
const API_KEY = process.env.QDRANT_API_KEY || undefined
// Unique per run so isolated `-t` filters and concurrent live jobs against the
// same Qdrant instance never share (or clobber) a collection.
const RUN_ID = `${process.pid}_${Date.now()}`
const SPARSE_COLLECTION = `eval_sparse_verify_${RUN_ID}`
const DENSE_COLLECTION = `eval_dense_verify_${RUN_ID}`
const DIM = 4
const SCOPE = { kbId: "kb_live", indexConfigHash: "h_live", documentId: "doc_live" }

function chunk(id: string, content: string): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc_live"),
    start: 0,
    end: content.length,
    metadata: { level: "child" }
  }
}

async function dropCollection(name: string): Promise<void> {
  const headers: Record<string, string> = {}
  if (API_KEY) headers["api-key"] = API_KEY
  await fetch(`${URL}/collections/${name}`, { method: "DELETE", headers }).catch(
    () => {}
  )
}

async function getCollection(name: string): Promise<any> {
  const headers: Record<string, string> = {}
  if (API_KEY) headers["api-key"] = API_KEY
  const res = await fetch(`${URL}/collections/${name}`, { headers })
  return res.json()
}

const run = LIVE ? describe : describe.skip

run("QdrantVectorStore live (sparse / named hybrid)", () => {
  // Construct lazily: the describe body is evaluated even when skipped, so a
  // top-level `new QdrantVectorStore({ url: "" })` would throw at collection
  // time. beforeAll runs only for the non-skipped (live) suite.
  let store: QdrantVectorStore
  const chunks = [
    chunk("c1", "alpha alpha banana"),
    chunk("c2", "bravo charlie delta"),
    chunk("c3", "echo foxtrot golf")
  ]
  const embeddings = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0]
  ]

  // Seed once up front so each `it` stands on its own regardless of run order.
  beforeAll(async () => {
    store = new QdrantVectorStore({
      url: URL,
      apiKey: API_KEY,
      collection: SPARSE_COLLECTION,
      dimension: DIM,
      sparse: true
    })
    await dropCollection(SPARSE_COLLECTION)
    await store.add(chunks, embeddings, SCOPE)
  })

  afterAll(async () => {
    await dropCollection(SPARSE_COLLECTION)
  })

  it("creates the named-hybrid collection and upserts dense + bm25", async () => {
    const info = await getCollection(SPARSE_COLLECTION)
    const params = info.result?.config?.params
    // Named dense vector present at the expected dimension...
    expect(params?.vectors?.dense?.size).toBe(DIM)
    // ...and a BM25 sparse vector with server-side IDF.
    expect(params?.sparse_vectors?.bm25?.modifier).toBe("idf")
  })

  it("searchSparse ranks by BM25/IDF (unique term wins)", async () => {
    const hits = await store.searchSparse("banana", {
      k: 3,
      filter: { kbId: SCOPE.kbId }
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(String(hits[0].chunk.id)).toBe("c1")
    expect(hits[0].score).toBeGreaterThan(0)
  })

  it("searchSparse matches a repeated term and returns the right chunk", async () => {
    const hits = await store.searchSparse("alpha", {
      k: 3,
      filter: { kbId: SCOPE.kbId }
    })
    expect(String(hits[0].chunk.id)).toBe("c1")
  })

  it("dense search (using: dense) still works on the hybrid collection", async () => {
    const hits = await store.search([1, 0, 0, 0], {
      k: 3,
      filter: { kbId: SCOPE.kbId }
    })
    expect(String(hits[0].chunk.id)).toBe("c1")
  })
})

run("QdrantVectorStore live (sparse: false unchanged)", () => {
  let store: QdrantVectorStore
  beforeAll(async () => {
    store = new QdrantVectorStore({
      url: URL,
      apiKey: API_KEY,
      collection: DENSE_COLLECTION,
      dimension: DIM
    })
    await dropCollection(DENSE_COLLECTION)
    await store.add([chunk("d1", "hello world")], [[1, 0, 0, 0]], SCOPE)
  })

  afterAll(async () => {
    await dropCollection(DENSE_COLLECTION)
  })

  it("creates an unnamed-dense collection (top-level vector size)", async () => {
    const info = await getCollection(DENSE_COLLECTION)
    const params = info.result?.config?.params
    expect(params?.vectors?.size).toBe(DIM)
    expect(params?.vectors?.dense).toBeUndefined()
  })

  it("dense search works and searchSparse no-ops to []", async () => {
    const hits = await store.search([1, 0, 0, 0], {
      k: 3,
      filter: { kbId: SCOPE.kbId }
    })
    expect(String(hits[0].chunk.id)).toBe("d1")
    expect(store.supportsSparse).toBe(false)
    expect(
      await store.searchSparse("hello", { k: 3, filter: { kbId: SCOPE.kbId } })
    ).toEqual([])
  })
})
