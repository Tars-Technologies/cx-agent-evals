import { CallbackVectorStore } from "@tars-inc/eval-lib"
import { describe, expect, it, vi } from "vitest"
import { internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import type { ActionCtx } from "../convex/_generated/server"
import {
  chunkResultsToScored,
  rawChunksToResults,
  scoredToChunkResults,
  wrapWithParentSwap
} from "../convex/kb/retrieval_runtime"

describe("rawChunksToResults", () => {
  it("maps Convex chunk rows + scoreMap to VectorSearchResult shape", () => {
    const rows = [
      {
        _id: "c1",
        chunkId: "chunk-1",
        content: "hello",
        docId: "doc-1",
        start: 0,
        end: 5,
        metadata: { level: "child" }
      }
    ]
    const scoreMap = new Map([["c1", 0.42]])
    const out = rawChunksToResults(rows, scoreMap)
    expect(out).toHaveLength(1)
    expect(String(out[0].chunk.id)).toBe("chunk-1")
    expect(out[0].chunk.content).toBe("hello")
    expect(String(out[0].chunk.docId)).toBe("doc-1")
    expect(out[0].chunk.start).toBe(0)
    expect(out[0].chunk.end).toBe(5)
    expect(out[0].score).toBe(0.42)
  })

  it("defaults missing scores to 0 and metadata to {}", () => {
    const out = rawChunksToResults(
      [
        {
          _id: "x",
          chunkId: "c",
          content: "",
          docId: "d",
          start: 0,
          end: 0,
          metadata: undefined
        }
      ],
      new Map()
    )
    expect(out[0].score).toBe(0)
    expect(out[0].chunk.metadata).toEqual({})
  })
})

describe("ScoredChunk <-> ChunkResult mapping", () => {
  const scored = {
    chunk: {
      id: "chunk-1" as never,
      content: "hello",
      docId: "doc-1" as never,
      start: 0,
      end: 5,
      metadata: { a: 1 }
    },
    score: 0.5
  }
  it("round-trips", () => {
    const [cr] = scoredToChunkResults([scored])
    expect(cr).toEqual({
      chunkId: "chunk-1",
      content: "hello",
      docId: "doc-1",
      start: 0,
      end: 5,
      score: 0.5,
      metadata: { a: 1 }
    })
    const [back] = chunkResultsToScored([cr])
    expect(String(back.chunk.id)).toBe("chunk-1")
    expect(back.score).toBe(0.5)
  })
})

describe("wrapWithParentSwap", () => {
  const KB_ID = "kb-123" as Id<"knowledgeBases">

  // An inner store that always returns the given children, ignoring the query.
  function innerReturning(children: Array<Record<string, unknown>>) {
    return new CallbackVectorStore({
      name: "inner",
      search: async () => children as never
    })
  }

  function childWithParent(parentChunkId: string | undefined) {
    return {
      chunk: {
        id: "child-1" as never,
        content: "child text",
        docId: "doc-1" as never,
        start: 0,
        end: 10,
        metadata: parentChunkId ? { parentChunkId } : {}
      },
      score: 0.8
    }
  }

  it("swaps a child for its parent and scopes the lookup to kbId", async () => {
    // Route by arg shape: fetchChunksByIds takes { ids, kbId }; fetchDocIdMap
    // takes { documentIds }. (The generated `internal` proxy does not preserve
    // reference identity across accesses, so we cannot route on the ref.)
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args && "ids" in args) {
        return [
          {
            _id: "parent-1",
            chunkId: "pchunk-1",
            content: "PARENT TEXT",
            documentId: "docx",
            start: 0,
            end: 11,
            metadata: { level: "parent" }
          }
        ]
      }
      return { docx: "doc-1" } // fetchDocIdMap
    })
    const ctx = { runQuery } as unknown as ActionCtx

    const store = wrapWithParentSwap(
      ctx,
      innerReturning([childWithParent("parent-1")]),
      KB_ID
    )
    const out = await store.search([0, 0, 0], { k: 5 })

    // The child was replaced by the parent row, carrying the child's score.
    expect(out).toHaveLength(1)
    expect(out[0].chunk.content).toBe("PARENT TEXT")
    expect(String(out[0].chunk.id)).toBe("pchunk-1")
    expect(out[0].score).toBe(0.8)

    // Security linchpin: the parent lookup MUST be scoped to this kbId.
    expect(runQuery).toHaveBeenCalledWith(
      internal.kb.chunks.fetchChunksByIds,
      expect.objectContaining({ ids: ["parent-1"], kbId: KB_ID })
    )
  })

  it("falls back to the child when the parent is not in this KB (no cross-tenant leak)", async () => {
    // Scoped lookup finds nothing — a foreign/poisoned parent id resolves to [].
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args && "ids" in args) return [] // scoped lookup finds nothing
      return {}
    })
    const ctx = { runQuery } as unknown as ActionCtx

    const store = wrapWithParentSwap(
      ctx,
      innerReturning([childWithParent("foreign-parent")]),
      KB_ID
    )
    const out = await store.search([0, 0, 0], { k: 5 })

    // The original child is kept; no foreign content surfaces.
    expect(out).toHaveLength(1)
    expect(out[0].chunk.content).toBe("child text")
    expect(String(out[0].chunk.id)).toBe("child-1")

    // The lookup was still scoped to kbId (that is what made it resolve to []).
    expect(runQuery).toHaveBeenCalledWith(
      internal.kb.chunks.fetchChunksByIds,
      expect.objectContaining({ ids: ["foreign-parent"], kbId: KB_ID })
    )
  })

  it("returns children unchanged and skips the lookup when none have a parent", async () => {
    const runQuery = vi.fn()
    const ctx = { runQuery } as unknown as ActionCtx

    const store = wrapWithParentSwap(
      ctx,
      innerReturning([childWithParent(undefined)]),
      KB_ID
    )
    const out = await store.search([0, 0, 0], { k: 5 })

    expect(out).toHaveLength(1)
    expect(out[0].chunk.content).toBe("child text")
    expect(runQuery).not.toHaveBeenCalled()
  })

  it("forwards sparse support and parent-swaps keyword (searchSparse) hits", async () => {
    // A sparse-capable inner store: keyword returns children that must be
    // swapped to parents exactly like dense results.
    const inner = new CallbackVectorStore({
      name: "inner",
      search: async () => [] as never,
      searchSparse: async () => [childWithParent("parent-1")] as never
    })
    const runQuery = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (args && "ids" in args) {
          return [
            {
              _id: "parent-1",
              chunkId: "pchunk-1",
              content: "PARENT TEXT",
              documentId: "docx",
              start: 0,
              end: 11,
              metadata: { level: "parent" }
            }
          ]
        }
        return { docx: "doc-1" }
      }
    )
    const ctx = { runQuery } as unknown as ActionCtx

    const store = wrapWithParentSwap(ctx, inner, KB_ID)
    expect(store.supportsSparse).toBe(true)

    const out = await store.searchSparse("alpha", { k: 5, filter: { kbId: "kb" } })
    expect(out).toHaveLength(1)
    expect(out[0].chunk.content).toBe("PARENT TEXT")
    expect(String(out[0].chunk.id)).toBe("pchunk-1")
    expect(out[0].score).toBe(0.8)
    // Same tenant-scoped parent lookup as the dense path.
    expect(runQuery).toHaveBeenCalledWith(
      internal.kb.chunks.fetchChunksByIds,
      expect.objectContaining({ ids: ["parent-1"], kbId: KB_ID })
    )
  })
})
