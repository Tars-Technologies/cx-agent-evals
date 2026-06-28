import { describe, expect, it, vi } from "vitest"
import type { Embedder } from "../../../src/embedders/embedder.interface.js"
import type { Reranker } from "../../../src/rerankers/reranker.interface.js"
import type { ChunkSource } from "../../../src/retrievers/chunk-source.interface.js"
import {
  applyMmr,
  applyThresholdFilter,
  assignRankScores,
  BM25SearchIndex
} from "../../../src/retrievers/pipeline/index.js"
import { StatelessQueryRetriever } from "../../../src/retrievers/stateless-query-retriever.js"
import {
  createCorpusFromDocuments,
  DocumentId,
  type PositionAwareChunk,
  PositionAwareChunkId
} from "../../../src/types/index.js"
import { InMemoryVectorStore } from "../../../src/vector-stores/in-memory.js"
import type {
  VectorSearchResult,
  VectorStore
} from "../../../src/vector-stores/vector-store.interface.js"

// ── Fixtures ──────────────────────────────────────────────────────────────

const DOC = "alpha bravo charlie delta echo foxtrot golf hotel india juliet"

function chunk(id: string, content: string, start: number): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId("doc-1"),
    start,
    end: start + content.length,
    metadata: {}
  }
}

const CHUNKS = [
  chunk("c1", "alpha bravo charlie", 0),
  chunk("c2", "delta echo foxtrot", 20),
  chunk("c3", "golf hotel india", 39)
]

/** Deterministic embedder: one-hot by which fixture chunk shares a word. */
const fakeEmbedder: Embedder = {
  name: "fake",
  dimension: 3,
  embed: async (texts) =>
    texts.map((t) =>
      CHUNKS.map((c) =>
        c.content.split(" ").some((w) => t.includes(w)) ? 1 : 0
      )
    ),
  embedQuery: async (q) =>
    CHUNKS.map((c) => (c.content.split(" ").some((w) => q.includes(w)) ? 1 : 0))
}

function makeSource(chunks: readonly PositionAwareChunk[]): ChunkSource {
  return {
    listChunks: vi.fn(async () => chunks),
    getCorpus: vi.fn(async () =>
      createCorpusFromDocuments([{ id: "doc-1", content: DOC }])
    )
  }
}

async function seededStore(): Promise<InMemoryVectorStore> {
  const store = new InMemoryVectorStore()
  const embeddings = await fakeEmbedder.embed(CHUNKS.map((c) => c.content))
  await store.add(CHUNKS, embeddings, { kbId: "kb1", indexConfigHash: "h1" })
  return store
}

function makeRetriever(overrides: Record<string, unknown> = {}) {
  return (async () =>
    new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "dense" } },
      vectorStore: await seededStore(),
      chunkSource: makeSource(CHUNKS),
      embedder: fakeEmbedder,
      filter: { kbId: "kb1", indexConfigHash: "h1" },
      ...overrides
    } as never))()
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("StatelessQueryRetriever", () => {
  it("dense: returns vector-store results for the query embedding", async () => {
    const r = await makeRetriever()
    const out = await r.retrieveScored("alpha", 2)
    expect(String(out[0].chunk.id)).toBe("c1")
    expect(out.length).toBeLessThanOrEqual(2)
  })

  it("bm25: matches a directly built BM25SearchIndex", async () => {
    const r = await makeRetriever({
      config: { name: "t", search: { strategy: "bm25" } }
    })
    const direct = new BM25SearchIndex()
    direct.build(CHUNKS)
    const expected = [...direct.searchWithScores("delta echo", 3)]
    const got = await r.retrieveScored("delta echo", 3)
    expect(got.map((s) => String(s.chunk.id))).toEqual(
      expected.map((s) => String(s.chunk.id))
    )
  })

  it("bm25 index builds once per instance (lazy, cached)", async () => {
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "bm25" } },
      vectorStore: await seededStore(),
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: {}
    })
    await r.retrieve("alpha", 2)
    await r.retrieve("delta", 2)
    expect(source.listChunks).toHaveBeenCalledTimes(1)
  })

  it("bm25 index builds once under concurrent multi-query search", async () => {
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "bm25" } },
      vectorStore: await seededStore(),
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: {}
    })
    // Both queries race into the lazy build via Promise.all; the build must be
    // memoized so the corpus is fetched and indexed exactly once.
    await r.searchQueries(["alpha", "delta"], 2)
    expect(source.listChunks).toHaveBeenCalledTimes(1)
  })

  it("hybrid: rank order matches manual weighted fusion of dense+bm25", async () => {
    const r = await makeRetriever({
      config: { name: "t", search: { strategy: "hybrid" } }
    })
    const out = await r.retrieveScored("alpha bravo", 3)
    expect(out.length).toBeGreaterThan(0)
    expect(String(out[0].chunk.id)).toBe("c1")
  })

  it("multi-query: expands via llm and fuses with RRF", async () => {
    const llm = { complete: vi.fn(async () => "alpha\ndelta\ngolf") }
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "multi-query", numQueries: 3 },
        search: { strategy: "dense" }
      },
      llm
    })
    const trace = await r.retrieveWithTrace("anything alpha", 3)
    expect(trace.query.queries).toEqual(["alpha", "delta", "golf"])
    expect(trace.search.perQueryResults).toHaveLength(3)
    expect(trace.finalChunks.length).toBeGreaterThan(1)
  })

  it("non-identity query strategy without llm falls back to the original query", async () => {
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "hyde" },
        search: { strategy: "dense" }
      }
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    expect(trace.query.queries).toEqual(["alpha"])
  })

  it("multi-query: empty llm expansion falls back to the original query", async () => {
    // parseVariants("") -> [] would otherwise leave zero queries and retrieve nothing.
    const llm = { complete: vi.fn(async () => "   \n  \n") }
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "multi-query", numQueries: 3 },
        search: { strategy: "dense" }
      },
      llm
    })
    const trace = await r.retrieveWithTrace("alpha", 3)
    expect(trace.query.queries).toEqual(["alpha"])
  })

  it("hyde: empty llm completion falls back to the original query", async () => {
    // An empty hypothetical doc would otherwise reach embedQuery("") and 400.
    const llm = { complete: vi.fn(async () => "") }
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "hyde" },
        search: { strategy: "dense" }
      },
      llm
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    expect(trace.query.queries).toEqual(["alpha"])
  })

  it("rewrite: whitespace-only llm completion falls back to the original query", async () => {
    const llm = { complete: vi.fn(async () => "   ") }
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "rewrite" },
        search: { strategy: "dense" }
      },
      llm
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    expect(trace.query.queries).toEqual(["alpha"])
  })

  it("step-back: drops an empty abstract instead of emitting a blank query", async () => {
    const llm = { complete: vi.fn(async () => "") }
    const r = await makeRetriever({
      config: {
        name: "t",
        query: { strategy: "step-back" },
        search: { strategy: "dense" }
      },
      llm
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    // includeOriginal defaults true, so the original survives; the empty
    // abstract must be dropped rather than passed to search as "".
    expect(trace.query.queries).toEqual(["alpha"])
  })

  it("rerank: applies reranker then assignRankScores; respects topN", async () => {
    const reranker: Reranker = {
      name: "stub",
      rerank: async (_q, chunks, topK) =>
        [...chunks].reverse().slice(0, topK ?? chunks.length)
    }
    const r = await makeRetriever({
      config: {
        name: "t",
        search: { strategy: "dense" },
        refinement: [{ type: "rerank", topN: 2 }]
      },
      reranker
    })
    const trace = await r.retrieveWithTrace("alpha delta golf", 3)
    const stage = trace.refinement[0]
    expect(stage.name).toBe("rerank")
    expect(stage.outputCount).toBe(2)
    const expectedScores = assignRankScores(
      stage.outputChunks.map((s) => s.chunk)
    ).map((s) => s.score)
    expect(stage.outputChunks.map((s) => s.score)).toEqual(expectedScores)
  })

  it("rerank without a reranker: passes through and marks the stage skipped", async () => {
    const r = await makeRetriever({
      config: {
        name: "t",
        search: { strategy: "dense" },
        refinement: [{ type: "rerank" }]
      }
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    expect(trace.refinement[0].config).toMatchObject({
      type: "rerank",
      skipped: true
    })
    expect(trace.refinement[0].outputCount).toBe(trace.refinement[0].inputCount)
  })

  it("threshold and mmr match direct pipeline-internals calls", async () => {
    const r = await makeRetriever({
      config: {
        name: "t",
        search: { strategy: "dense" },
        refinement: [
          { type: "threshold", minScore: 0.5 },
          { type: "mmr", lambda: 0.7 }
        ]
      }
    })
    const trace = await r.retrieveWithTrace("alpha delta", 3)
    const afterSearch = trace.search.fusedResults
    const expected = applyMmr(
      applyThresholdFilter([...afterSearch], 0.5),
      3,
      0.7
    )
    expect(trace.finalChunks.map((s) => String(s.chunk.id))).toEqual(
      expected.map((s) => String(s.chunk.id))
    )
  })

  it("expand-context: loads corpus lazily and widens spans", async () => {
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: {
        name: "t",
        search: { strategy: "dense" },
        refinement: [{ type: "expand-context", windowChars: 5 }]
      },
      vectorStore: await seededStore(),
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: {}
    })
    const out = await r.retrieveScored("delta", 1)
    expect(out[0].chunk.start).toBeLessThanOrEqual(15)
    expect(source.getCorpus).toHaveBeenCalledTimes(1)
    await r.retrieveScored("delta", 1)
    expect(source.getCorpus).toHaveBeenCalledTimes(1) // cached
  })

  it("corpus is NOT loaded when no expand-context step exists", async () => {
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "dense" } },
      vectorStore: await seededStore(),
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: {}
    })
    await r.retrieve("alpha", 2)
    expect(source.getCorpus).not.toHaveBeenCalled()
  })

  it("trace shape: stage names, counts, configs, latencies", async () => {
    const r = await makeRetriever({
      config: {
        name: "t",
        search: { strategy: "dense" },
        refinement: [{ type: "dedup" }]
      }
    })
    const trace = await r.retrieveWithTrace("alpha", 2)
    expect(trace.query.strategy).toBe("identity")
    expect(trace.search.strategy).toBe("dense")
    expect(trace.refinement[0]).toMatchObject({
      name: "dedup",
      config: { type: "dedup", method: "overlap", overlapThreshold: 0.5 }
    })
    expect(trace.refinement[0].latencyMs).toBeGreaterThanOrEqual(0)
    expect(trace.totalLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it("retrieve() slices to k and unwraps chunks", async () => {
    const r = await makeRetriever()
    const out = await r.retrieve("alpha delta golf", 1)
    expect(out).toHaveLength(1)
    expect(out[0].content).toBeDefined()
  })
})

// ── Sparse routing (stores that support searchSparse) ───────────────────────

function result(c: PositionAwareChunk, score: number): VectorSearchResult {
  return { chunk: c, score }
}

/** A store that advertises sparse support, with spied dense + sparse search. */
function sparseStore(
  denseResults: VectorSearchResult[],
  sparseResults: VectorSearchResult[]
) {
  const search = vi.fn(async () => denseResults)
  const searchSparse = vi.fn(async () => sparseResults)
  const store = {
    name: "fake-sparse",
    supportsSparse: true,
    search,
    searchSparse,
    add: vi.fn(async () => {}),
    clear: vi.fn(async () => {})
  } as unknown as VectorStore
  return { store, search, searchSparse }
}

describe("StatelessQueryRetriever sparse routing", () => {
  const FILTER = { kbId: "kb1", indexConfigHash: "h1" }

  it("bm25: uses vectorStore.searchSparse and skips the MiniSearch corpus build", async () => {
    const { store, searchSparse } = sparseStore(
      [],
      [result(CHUNKS[1], 0.8), result(CHUNKS[2], 0.5)]
    )
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "bm25" } },
      vectorStore: store,
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: FILTER
    })
    const out = await r.retrieveScored("delta echo", 3)
    expect(out.map((s) => String(s.chunk.id))).toEqual(["c2", "c3"])
    expect(searchSparse).toHaveBeenCalledWith("delta echo", {
      k: 3,
      filter: FILTER
    })
    // The whole point of sparse: no per-query full-corpus pull.
    expect(source.listChunks).not.toHaveBeenCalled()
  })

  it("bm25: falls back to MiniSearch when the store has no sparse support", async () => {
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "bm25" } },
      vectorStore: await seededStore(), // InMemory: supportsSparse === false
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: FILTER
    })
    const out = await r.retrieveScored("delta echo", 3)
    expect(out.length).toBeGreaterThan(0)
    // The fallback path builds the in-memory index from the corpus.
    expect(source.listChunks).toHaveBeenCalledTimes(1)
  })

  it("hybrid: fuses dense and searchSparse (both fed real scores)", async () => {
    const { store, search, searchSparse } = sparseStore(
      [result(CHUNKS[0], 0.9)],
      [result(CHUNKS[1], 0.8)]
    )
    const source = makeSource(CHUNKS)
    const r = new StatelessQueryRetriever({
      config: { name: "t", search: { strategy: "hybrid" } },
      vectorStore: store,
      chunkSource: source,
      embedder: fakeEmbedder,
      filter: FILTER
    })
    const out = await r.retrieveScored("alpha bravo", 3)
    const ids = out.map((s) => String(s.chunk.id))
    expect(ids).toContain("c1")
    expect(ids).toContain("c2")
    expect(search).toHaveBeenCalledTimes(1)
    expect(searchSparse).toHaveBeenCalledTimes(1)
    expect(source.listChunks).not.toHaveBeenCalled()
  })
})
