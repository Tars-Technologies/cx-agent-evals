import { describe, expect, it } from "vitest"
import {
  chunkResultsToScored,
  rawChunksToResults,
  scoredToChunkResults
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
