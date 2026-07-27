import { describe, expect, it, vi } from "vitest"
import { runRetrieverEvaluation } from "../../../src/experiments/run-retriever-evaluation.js"
import type { ExperimentResult } from "../../../src/shared/types.js"
import type { Corpus, PositionAwareChunk } from "../../../src/types/index.js"
import {
  DocumentId,
  PositionAwareChunkId
} from "../../../src/types/primitives.js"

const corpus: Corpus = {
  documents: [{ id: DocumentId("doc1"), content: "Hello world", metadata: {} }],
  metadata: {}
}

const chunk = (start: number, end: number, content: string): PositionAwareChunk => ({
  id: PositionAwareChunkId(`${start}:${end}`),
  docId: DocumentId("doc1"),
  content,
  start,
  end,
  metadata: {}
})

describe("runRetrieverEvaluation", () => {
  it("scores each example and fires onResult, calling init/cleanup once", async () => {
    const retriever = {
      name: "test",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => [chunk(0, 11, "Hello world")]),
      cleanup: vi.fn(async () => {})
    }
    const results: ExperimentResult[] = []
    await runRetrieverEvaluation({
      corpus,
      retriever,
      k: 5,
      dataset: [
        {
          query: "hi",
          groundTruth: [{ docId: DocumentId("doc1"), start: 0, end: 11, text: "Hello world" }]
        }
      ],
      onResult: async (r) => {
        results.push(r)
      }
    })
    expect(retriever.init).toHaveBeenCalledOnce()
    expect(retriever.cleanup).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
    expect(results[0].query).toBe("hi")
    expect(results[0].scores.recall).toBe(1)
    expect(results[0].retrievedSpans[0].docId).toBe("doc1")
  })

  it("runs cleanup even when retrieve throws", async () => {
    const retriever = {
      name: "boom",
      init: vi.fn(async () => {}),
      retrieve: vi.fn(async () => {
        throw new Error("nope")
      }),
      cleanup: vi.fn(async () => {})
    }
    await expect(
      runRetrieverEvaluation({
        corpus,
        retriever,
        k: 5,
        dataset: [{ query: "q", groundTruth: [] }]
      })
    ).rejects.toThrow("nope")
    expect(retriever.cleanup).toHaveBeenCalledOnce()
  })
})
